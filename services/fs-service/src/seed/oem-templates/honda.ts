import type { MappingTemplate } from './types';

/**
 * Honda Financial Statement mapping template.
 *
 * @cobol-origin finstmhnd*.cbl — Honda OEM financial statement programs.
 */
export const HONDA_MAPPING_TEMPLATE: MappingTemplate = {
  oemCode: 'HONDA',
  lines: [
    { lineNumber: '101', label: 'New Vehicle Sales',       section: 'REVENUE',       glAccountCodes: ['4010', '4011'],         displayOrder: 10 },
    { lineNumber: '102', label: 'Used Vehicle Sales',      section: 'REVENUE',       glAccountCodes: ['4020', '4021'],         displayOrder: 20 },
    { lineNumber: '103', label: 'Parts & Accessories',     section: 'REVENUE',       glAccountCodes: ['4030'],                 displayOrder: 30 },
    { lineNumber: '104', label: 'Service Revenue',         section: 'REVENUE',       glAccountCodes: ['4040', '4041'],         displayOrder: 40 },
    { lineNumber: '105', label: 'F&I Income',              section: 'REVENUE',       glAccountCodes: ['4060'],                 displayOrder: 50 },
    { lineNumber: '106', label: 'Other Income',            section: 'REVENUE',       glAccountCodes: ['4090'],                 displayOrder: 60 },
    { lineNumber: '199', label: 'Total Revenue',           section: 'REVENUE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_101 + LINE_102 + LINE_103 + LINE_104 + LINE_105 + LINE_106', displayOrder: 70, isTotal: true },
    { lineNumber: '201', label: 'New Vehicle Cost',        section: 'COST_OF_SALES', glAccountCodes: ['5010'],                 displayOrder: 80 },
    { lineNumber: '202', label: 'Used Vehicle Cost',       section: 'COST_OF_SALES', glAccountCodes: ['5020'],                 displayOrder: 90 },
    { lineNumber: '203', label: 'Parts Cost',              section: 'COST_OF_SALES', glAccountCodes: ['5030'],                 displayOrder: 100 },
    { lineNumber: '204', label: 'Service Cost',            section: 'COST_OF_SALES', glAccountCodes: ['5040'],                 displayOrder: 110 },
    { lineNumber: '299', label: 'Total Cost of Sales',     section: 'COST_OF_SALES', glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_201 + LINE_202 + LINE_203 + LINE_204', displayOrder: 120, isTotal: true },
    { lineNumber: '300', label: 'Gross Profit',            section: 'GROSS_PROFIT',  glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_199 - LINE_299', displayOrder: 130, isSubtotal: true, isTotal: true },
    { lineNumber: '401', label: 'Personnel',               section: 'EXPENSE',       glAccountCodes: ['6010'],                 displayOrder: 140 },
    { lineNumber: '402', label: 'Marketing',               section: 'EXPENSE',       glAccountCodes: ['6020'],                 displayOrder: 150 },
    { lineNumber: '403', label: 'Floor Plan Interest',     section: 'EXPENSE',       glAccountCodes: ['6030'],                 displayOrder: 160 },
    { lineNumber: '404', label: 'Facility',                section: 'EXPENSE',       glAccountCodes: ['6040'],                 displayOrder: 170 },
    { lineNumber: '405', label: 'General & Administrative',section: 'EXPENSE',       glAccountCodes: ['6050'],                 displayOrder: 180 },
    { lineNumber: '499', label: 'Total Expense',           section: 'EXPENSE',       glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_401 + LINE_402 + LINE_403 + LINE_404 + LINE_405', displayOrder: 190, isTotal: true },
    { lineNumber: '500', label: 'Net Income Before Tax',   section: 'OTHER',         glAccountCodes: [], calculationType: 'FORMULA', formula: 'LINE_300 - LINE_499', displayOrder: 200, isTotal: true },
  ],
};
