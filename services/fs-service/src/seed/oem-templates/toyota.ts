import type { MappingTemplate } from './types';

/**
 * Toyota Financial Statement mapping template.
 *
 * @cobol-origin finstmtoy*.cbl — Toyota OEM financial statement programs.
 * Toyota requires used vehicle department as a separate profit center.
 */
export const TOYOTA_MAPPING_TEMPLATE: MappingTemplate = {
  oemCode: 'TOYOTA',
  lines: [
    // REVENUE section — Toyota separates New/Used as distinct profit centers
    { lineNumber: '101', label: 'New Vehicle Sales',       section: 'REVENUE',       glAccountCodes: ['4010', '4011'],         displayOrder: 10 },
    { lineNumber: '102', label: 'Used Vehicle Sales',      section: 'REVENUE',       glAccountCodes: ['4020', '4021'],         displayOrder: 20 },
    { lineNumber: '103', label: 'Certified Pre-Owned',     section: 'REVENUE',       glAccountCodes: ['4022'],                 displayOrder: 30 },
    { lineNumber: '104', label: 'Parts & Accessories',     section: 'REVENUE',       glAccountCodes: ['4030', '4031'],         displayOrder: 40 },
    { lineNumber: '105', label: 'Service & Repair',        section: 'REVENUE',       glAccountCodes: ['4040', '4041'],         displayOrder: 50 },
    { lineNumber: '106', label: 'F&I Products',            section: 'REVENUE',       glAccountCodes: ['4060', '4061'],         displayOrder: 60 },
    { lineNumber: '107', label: 'Other Revenue',           section: 'REVENUE',       glAccountCodes: ['4090'],                 displayOrder: 70 },
    { lineNumber: '199', label: 'Total Revenue',           section: 'REVENUE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_101 + LINE_102 + LINE_103 + LINE_104 + LINE_105 + LINE_106 + LINE_107', displayOrder: 80, isTotal: true },
    // COST_OF_SALES
    { lineNumber: '201', label: 'New Vehicle Cost',        section: 'COST_OF_SALES', glAccountCodes: ['5010'],                 displayOrder: 90 },
    { lineNumber: '202', label: 'Used Vehicle Cost',       section: 'COST_OF_SALES', glAccountCodes: ['5020'],                 displayOrder: 100 },
    { lineNumber: '203', label: 'CPO Vehicle Cost',        section: 'COST_OF_SALES', glAccountCodes: ['5022'],                 displayOrder: 110 },
    { lineNumber: '204', label: 'Parts Cost',              section: 'COST_OF_SALES', glAccountCodes: ['5030'],                 displayOrder: 120 },
    { lineNumber: '205', label: 'Service Cost',            section: 'COST_OF_SALES', glAccountCodes: ['5040'],                 displayOrder: 130 },
    { lineNumber: '299', label: 'Total Cost of Sales',     section: 'COST_OF_SALES', glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_201 + LINE_202 + LINE_203 + LINE_204 + LINE_205', displayOrder: 140, isTotal: true },
    // GROSS_PROFIT
    { lineNumber: '300', label: 'Gross Profit',            section: 'GROSS_PROFIT',  glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_199 - LINE_299', displayOrder: 150, isSubtotal: true, isTotal: true },
    // EXPENSE
    { lineNumber: '401', label: 'Personnel',               section: 'EXPENSE',       glAccountCodes: ['6010', '6011'],         displayOrder: 160 },
    { lineNumber: '402', label: 'Advertising',             section: 'EXPENSE',       glAccountCodes: ['6020'],                 displayOrder: 170 },
    { lineNumber: '403', label: 'Floor Plan Interest',     section: 'EXPENSE',       glAccountCodes: ['6030'],                 displayOrder: 180 },
    { lineNumber: '404', label: 'Occupancy',               section: 'EXPENSE',       glAccountCodes: ['6040'],                 displayOrder: 190 },
    { lineNumber: '405', label: 'General & Administrative',section: 'EXPENSE',       glAccountCodes: ['6050'],                 displayOrder: 200 },
    { lineNumber: '499', label: 'Total Expense',           section: 'EXPENSE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_401 + LINE_402 + LINE_403 + LINE_404 + LINE_405', displayOrder: 210, isTotal: true },
    // OTHER
    { lineNumber: '500', label: 'Net Income Before Tax',   section: 'OTHER',         glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_300 - LINE_499', displayOrder: 220, isTotal: true },
  ],
};
