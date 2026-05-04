import type { MappingTemplate } from './types';

/**
 * Ford OWS (Operating Worldwide System) financial statement mapping template.
 *
 * @cobol-origin finstmfd*.cbl — Ford OEM financial statement programs.
 * Ford requires parts, service, and F&I reported as separate line items.
 */
export const FORD_MAPPING_TEMPLATE: MappingTemplate = {
  oemCode: 'FORD',
  lines: [
    // REVENUE section
    { lineNumber: '101', label: 'New Vehicle Sales',       section: 'REVENUE',       glAccountCodes: ['4010', '4011'],         displayOrder: 10 },
    { lineNumber: '102', label: 'Used Vehicle Sales',      section: 'REVENUE',       glAccountCodes: ['4020', '4021'],         displayOrder: 20 },
    { lineNumber: '103', label: 'Parts Sales',             section: 'REVENUE',       glAccountCodes: ['4030', '4031'],         displayOrder: 30 },
    { lineNumber: '104', label: 'Service Labor',           section: 'REVENUE',       glAccountCodes: ['4040', '4041'],         displayOrder: 40 },
    { lineNumber: '105', label: 'Body Shop Revenue',       section: 'REVENUE',       glAccountCodes: ['4050'],                 displayOrder: 50 },
    { lineNumber: '106', label: 'F&I Income',              section: 'REVENUE',       glAccountCodes: ['4060', '4061', '4062'], displayOrder: 60 },
    { lineNumber: '107', label: 'Quick Lane Revenue',      section: 'REVENUE',       glAccountCodes: ['4070'],                 displayOrder: 70 },
    { lineNumber: '108', label: 'Other Income',            section: 'REVENUE',       glAccountCodes: ['4090'],                 displayOrder: 80 },
    { lineNumber: '199', label: 'Total Revenue',           section: 'REVENUE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_101 + LINE_102 + LINE_103 + LINE_104 + LINE_105 + LINE_106 + LINE_107 + LINE_108', displayOrder: 90, isTotal: true },
    // COST_OF_SALES section
    { lineNumber: '201', label: 'New Vehicle Cost',        section: 'COST_OF_SALES', glAccountCodes: ['5010', '5011'],         displayOrder: 100 },
    { lineNumber: '202', label: 'Used Vehicle Cost',       section: 'COST_OF_SALES', glAccountCodes: ['5020'],                 displayOrder: 110 },
    { lineNumber: '203', label: 'Parts Cost',              section: 'COST_OF_SALES', glAccountCodes: ['5030', '5031'],         displayOrder: 120 },
    { lineNumber: '204', label: 'Service Cost',            section: 'COST_OF_SALES', glAccountCodes: ['5040'],                 displayOrder: 130 },
    { lineNumber: '205', label: 'Body Shop Cost',          section: 'COST_OF_SALES', glAccountCodes: ['5050'],                 displayOrder: 140 },
    { lineNumber: '299', label: 'Total Cost of Sales',     section: 'COST_OF_SALES', glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_201 + LINE_202 + LINE_203 + LINE_204 + LINE_205', displayOrder: 150, isTotal: true },
    // GROSS_PROFIT
    { lineNumber: '300', label: 'Gross Profit',            section: 'GROSS_PROFIT',  glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_199 - LINE_299', displayOrder: 160, isSubtotal: true, isTotal: true },
    // EXPENSE section
    { lineNumber: '401', label: 'Salaries & Wages',        section: 'EXPENSE',       glAccountCodes: ['6010', '6011'],         displayOrder: 170 },
    { lineNumber: '402', label: 'Advertising & Marketing', section: 'EXPENSE',       glAccountCodes: ['6020'],                 displayOrder: 180 },
    { lineNumber: '403', label: 'Floor Plan Interest',     section: 'EXPENSE',       glAccountCodes: ['6030'],                 displayOrder: 190 },
    { lineNumber: '404', label: 'Facility Costs',          section: 'EXPENSE',       glAccountCodes: ['6040', '6041'],         displayOrder: 200 },
    { lineNumber: '405', label: 'Administrative Expense',  section: 'EXPENSE',       glAccountCodes: ['6050', '6051'],         displayOrder: 210 },
    { lineNumber: '406', label: 'Other Expense',           section: 'EXPENSE',       glAccountCodes: ['6090'],                 displayOrder: 220 },
    { lineNumber: '499', label: 'Total Expense',           section: 'EXPENSE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_401 + LINE_402 + LINE_403 + LINE_404 + LINE_405 + LINE_406', displayOrder: 230, isTotal: true },
    // OTHER
    { lineNumber: '500', label: 'Net Income Before Tax',   section: 'OTHER',         glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_300 - LINE_499', displayOrder: 240, isTotal: true },
  ],
};
