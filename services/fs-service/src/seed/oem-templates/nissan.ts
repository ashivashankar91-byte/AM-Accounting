import type { MappingTemplate } from './types';

/**
 * Nissan Financial Statement mapping template.
 *
 * @cobol-origin finstmnss*.cbl — Nissan OEM financial statement programs.
 */
export const NISSAN_MAPPING_TEMPLATE: MappingTemplate = {
  oemCode: 'NISSAN',
  lines: [
    { lineNumber: '101', label: 'New Vehicle Sales',       section: 'REVENUE',       glAccountCodes: ['4010', '4011'],         displayOrder: 10 },
    { lineNumber: '102', label: 'Used Vehicle Sales',      section: 'REVENUE',       glAccountCodes: ['4020'],                 displayOrder: 20 },
    { lineNumber: '103', label: 'Parts & Service',         section: 'REVENUE',       glAccountCodes: ['4030', '4040'],         displayOrder: 30 },
    { lineNumber: '104', label: 'F&I & Other',             section: 'REVENUE',       glAccountCodes: ['4060', '4090'],         displayOrder: 40 },
    { lineNumber: '199', label: 'Total Revenue',           section: 'REVENUE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_101 + LINE_102 + LINE_103 + LINE_104', displayOrder: 50, isTotal: true },
    { lineNumber: '201', label: 'Vehicle Cost of Sales',   section: 'COST_OF_SALES', glAccountCodes: ['5010', '5020'],         displayOrder: 60 },
    { lineNumber: '202', label: 'Parts & Service Cost',    section: 'COST_OF_SALES', glAccountCodes: ['5030', '5040'],         displayOrder: 70 },
    { lineNumber: '299', label: 'Total Cost of Sales',     section: 'COST_OF_SALES', glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_201 + LINE_202', displayOrder: 80, isTotal: true },
    { lineNumber: '300', label: 'Gross Profit',            section: 'GROSS_PROFIT',  glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_199 - LINE_299', displayOrder: 90, isSubtotal: true, isTotal: true },
    { lineNumber: '401', label: 'Personnel',               section: 'EXPENSE',       glAccountCodes: ['6010'],                 displayOrder: 100 },
    { lineNumber: '402', label: 'Selling Expense',         section: 'EXPENSE',       glAccountCodes: ['6020', '6021'],         displayOrder: 110 },
    { lineNumber: '403', label: 'Floor Plan & Finance',    section: 'EXPENSE',       glAccountCodes: ['6030'],                 displayOrder: 120 },
    { lineNumber: '404', label: 'Fixed Expense',           section: 'EXPENSE',       glAccountCodes: ['6040', '6050'],         displayOrder: 130 },
    { lineNumber: '499', label: 'Total Expense',           section: 'EXPENSE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_401 + LINE_402 + LINE_403 + LINE_404', displayOrder: 140, isTotal: true },
    { lineNumber: '500', label: 'Net Income Before Tax',   section: 'OTHER',         glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_300 - LINE_499', displayOrder: 150, isTotal: true },
  ],
};
