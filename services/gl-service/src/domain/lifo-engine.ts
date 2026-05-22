import { Decimal } from '@prisma/client/runtime/library';

/**
 * BUILD-013: LIFO Inventory Valuation Engine
 *
 * Computes LIFO inventory valuations for inventory accounts using:
 * - Link-Chain method (method '1'): compares current vs prior year quantities, applies current cost to additions
 * - Double-Extension method (method '2'): extends inventory at base-year and current-year prices, applies price index
 *
 * Does NOT modify GL balances — reads inventory data and produces valuation reports.
 * @cobol-origin LIFO valuation in inventory reconciliation programs (invmtch.cbl, etc.)
 */

export interface InventoryAccount {
  accountId: string;
  accountCode: string;
  beginningQuantity: number;
  endingQuantity: number;
  beginningCost: Decimal;
  endingCost: Decimal;
  currentYearCost: Decimal;
  unitCost: Decimal;
}

export interface LIFOLayer {
  layerYear: number;
  quantity: number;
  unitCost: Decimal;
  totalCost: Decimal;
}

export interface LIFOValuationResult {
  accountId: string;
  accountCode: string;
  fiscalYear: number;
  lifoMethod: string;
  beginningInventory: Decimal;
  endingInventory: Decimal;
  layers: LIFOLayer[];
  lifoReserve: Decimal;
  costOfGoodsSold: Decimal;
}

export class LIFOEngine {
  /**
   * Link-Chain LIFO Method (method '1')
   *
   * Algorithm:
   * 1. Compare current year ending quantity to prior year ending quantity
   * 2. If quantity increased: value increment at current year cost
   * 3. If quantity decreased: peel layers from most recent year backward
   * 4. Maintain cumulative layer stack with year, quantity, unit_cost
   */
  linkChainValuation(
    account: InventoryAccount,
    currentLayers: LIFOLayer[],
    priorYearEndingQuantity: number,
    fiscalYear: number,
  ): LIFOValuationResult {
    const newLayers = [...currentLayers];
    const currentQuantity = account.endingQuantity;
    const quantityChange = currentQuantity - priorYearEndingQuantity;

    if (quantityChange > 0) {
      // Quantity increased — add new layer at current cost
      newLayers.push({
        layerYear: fiscalYear,
        quantity: quantityChange,
        unitCost: account.unitCost,
        totalCost: new Decimal(quantityChange).times(account.unitCost),
      });
    } else if (quantityChange < 0) {
      // Quantity decreased — peel layers from most recent backward
      let quantityToPeel = Math.abs(quantityChange);
      for (let i = newLayers.length - 1; i >= 0 && quantityToPeel > 0; i--) {
        const layer = newLayers[i];
        const peeled = Math.min(layer.quantity, quantityToPeel);
        layer.quantity -= peeled;
        layer.totalCost = new Decimal(layer.quantity).times(layer.unitCost);
        quantityToPeel -= peeled;
        if (layer.quantity === 0) {
          newLayers.splice(i, 1);
        }
      }
    }

    const lifoInventoryValue = newLayers.reduce(
      (sum, layer) => sum.plus(layer.totalCost),
      new Decimal(0),
    );
    const lifoReserve = account.endingCost.minus(lifoInventoryValue);
    const costOfGoodsSold = account.beginningCost.plus(account.currentYearCost).minus(lifoInventoryValue);

    return {
      accountId: account.accountId,
      accountCode: account.accountCode,
      fiscalYear,
      lifoMethod: 'LINK_CHAIN',
      beginningInventory: account.beginningCost,
      endingInventory: lifoInventoryValue,
      layers: newLayers,
      lifoReserve,
      costOfGoodsSold,
    };
  }

  /**
   * Double-Extension LIFO Method (method '2')
   *
   * Algorithm:
   * 1. Extend ending inventory at both base-year prices (layer-year cost) and current-year prices
   * 2. Compute price index = current_extension / base_extension
   * 3. Apply index to base-year value to determine LIFO value
   * 4. Peel layers from most recent if inventory decreased
   */
  doubleExtensionValuation(
    account: InventoryAccount,
    currentLayers: LIFOLayer[],
    priorYearEndingQuantity: number,
    fiscalYear: number,
    baseYearUnitCost: Decimal,
  ): LIFOValuationResult {
    const newLayers = [...currentLayers];
    const currentQuantity = account.endingQuantity;
    const quantityChange = currentQuantity - priorYearEndingQuantity;

    if (quantityChange > 0) {
      // Quantity increased — add new layer
      newLayers.push({
        layerYear: fiscalYear,
        quantity: quantityChange,
        unitCost: account.unitCost,
        totalCost: new Decimal(quantityChange).times(account.unitCost),
      });
    } else if (quantityChange < 0) {
      // Quantity decreased — peel layers from most recent backward
      let quantityToPeel = Math.abs(quantityChange);
      for (let i = newLayers.length - 1; i >= 0 && quantityToPeel > 0; i--) {
        const layer = newLayers[i];
        const peeled = Math.min(layer.quantity, quantityToPeel);
        layer.quantity -= peeled;
        layer.totalCost = new Decimal(layer.quantity).times(layer.unitCost);
        quantityToPeel -= peeled;
        if (layer.quantity === 0) {
          newLayers.splice(i, 1);
        }
      }
    }

    // Compute price index
    const baseExtension = newLayers.reduce(
      (sum, layer) => sum.plus(new Decimal(layer.quantity).times(baseYearUnitCost)),
      new Decimal(0),
    );
    const currentExtension = newLayers.reduce(
      (sum, layer) => sum.plus(layer.totalCost),
      new Decimal(0),
    );
    const priceIndex = baseExtension.isZero() ? new Decimal(1) : currentExtension.dividedBy(baseExtension);

    // Apply index to determine LIFO value
    const lifoInventoryValue = baseExtension.times(priceIndex);
    const lifoReserve = account.endingCost.minus(lifoInventoryValue);
    const costOfGoodsSold = account.beginningCost.plus(account.currentYearCost).minus(lifoInventoryValue);

    return {
      accountId: account.accountId,
      accountCode: account.accountCode,
      fiscalYear,
      lifoMethod: 'DOUBLE_EXTENSION',
      beginningInventory: account.beginningCost,
      endingInventory: lifoInventoryValue,
      layers: newLayers,
      lifoReserve,
      costOfGoodsSold,
    };
  }

  /**
   * Determine LIFO method from gl_system_config
   * '0' = None (skip LIFO calculation)
   * '1' = Link-Chain method
   * '2' = Double-Extension method
   */
  getLifoMethod(configValue: string): '0' | '1' | '2' {
    if (configValue === '0') return '0';
    if (configValue === '1') return '1';
    if (configValue === '2') return '2';
    return '0'; // Default to no LIFO
  }
}
