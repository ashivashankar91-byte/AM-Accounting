import type { MappingTemplate } from './types';

/**
 * GM Financial Statement mapping template.
 *
 * @cobol-origin finstmgm*.cbl — GM OEM financial statement programs.
 * Each year a new program was written when GM changed report line numbers.
 * This config-driven template replaces all GM finstm* programs.
 * Adding a new model year is a configuration update, not a code change.
 */
export const GM_MAPPING_TEMPLATE: MappingTemplate = {
  oemCode: 'GM',
  lines: [
    // REVENUE section
    { lineNumber: '101', label: 'New Vehicle Sales',        section: 'REVENUE',       glAccountCodes: ['4010', '4011', '4012'], displayOrder: 10 },
    { lineNumber: '102', label: 'Used Vehicle Sales',       section: 'REVENUE',       glAccountCodes: ['4020', '4021'],         displayOrder: 20 },
    { lineNumber: '103', label: 'Parts Sales - Customer',   section: 'REVENUE',       glAccountCodes: ['4030'],                 displayOrder: 30 },
    { lineNumber: '104', label: 'Parts Sales - Internal',   section: 'REVENUE',       glAccountCodes: ['4031'],                 displayOrder: 40 },
    { lineNumber: '105', label: 'Service Labor Sales',      section: 'REVENUE',       glAccountCodes: ['4040', '4041'],         displayOrder: 50 },
    { lineNumber: '106', label: 'Body Shop Labor',          section: 'REVENUE',       glAccountCodes: ['4050'],                 displayOrder: 60 },
    { lineNumber: '107', label: 'F&I Income',               section: 'REVENUE',       glAccountCodes: ['4060', '4061', '4062'], displayOrder: 70 },
    { lineNumber: '108', label: 'Other Revenue',            section: 'REVENUE',       glAccountCodes: ['4090'],                 displayOrder: 80 },
    { lineNumber: '199', label: 'Total Revenue',            section: 'REVENUE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_101 + LINE_102 + LINE_103 + LINE_104 + LINE_105 + LINE_106 + LINE_107 + LINE_108', displayOrder: 90, isTotal: true },
    // COST_OF_SALES section
    { lineNumber: '201', label: 'New Vehicle Cost',         section: 'COST_OF_SALES', glAccountCodes: ['5010', '5011'],         displayOrder: 100 },
    { lineNumber: '202', label: 'Used Vehicle Cost',        section: 'COST_OF_SALES', glAccountCodes: ['5020'],                 displayOrder: 110 },
    { lineNumber: '203', label: 'Parts Cost of Sales',      section: 'COST_OF_SALES', glAccountCodes: ['5030', '5031'],         displayOrder: 120 },
    { lineNumber: '204', label: 'Service Cost of Sales',    section: 'COST_OF_SALES', glAccountCodes: ['5040'],                 displayOrder: 130 },
    { lineNumber: '205', label: 'Body Shop Cost',           section: 'COST_OF_SALES', glAccountCodes: ['5050'],                 displayOrder: 140 },
    { lineNumber: '299', label: 'Total Cost of Sales',      section: 'COST_OF_SALES', glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_201 + LINE_202 + LINE_203 + LINE_204 + LINE_205', displayOrder: 150, isTotal: true },
    // GROSS_PROFIT section
    { lineNumber: '300', label: 'Gross Profit',             section: 'GROSS_PROFIT',  glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_199 - LINE_299', displayOrder: 160, isSubtotal: true, isTotal: true },
    // EXPENSE section
    { lineNumber: '401', label: 'Personnel Expense',        section: 'EXPENSE',       glAccountCodes: ['6010', '6011', '6012'], displayOrder: 170 },
    { lineNumber: '402', label: 'Advertising',              section: 'EXPENSE',       glAccountCodes: ['6020'],                 displayOrder: 180 },
    { lineNumber: '403', label: 'Floor Plan Interest',      section: 'EXPENSE',       glAccountCodes: ['6030'],                 displayOrder: 190 },
    { lineNumber: '404', label: 'Occupancy Expense',        section: 'EXPENSE',       glAccountCodes: ['6040', '6041'],         displayOrder: 200 },
    { lineNumber: '405', label: 'General & Administrative', section: 'EXPENSE',       glAccountCodes: ['6050', '6051', '6052'], displayOrder: 210 },
    { lineNumber: '406', label: 'Other Expense',            section: 'EXPENSE',       glAccountCodes: ['6090'],                 displayOrder: 220 },
    { lineNumber: '499', label: 'Total Expense',            section: 'EXPENSE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_401 + LINE_402 + LINE_403 + LINE_404 + LINE_405 + LINE_406', displayOrder: 230, isTotal: true },
    // OTHER section (Net Income)
    { lineNumber: '500', label: 'Net Income Before Tax',    section: 'OTHER',         glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_300 - LINE_499', displayOrder: 240, isTotal: true },
  ],
};
