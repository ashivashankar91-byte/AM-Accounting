export interface MappingTemplateLine {
  lineNumber: string;
  label: string;
  section: string;
  glAccountCodes: string[];
  calculationType?: 'SUM' | 'DIFFERENCE' | 'FORMULA';
  formula?: string;
  displayOrder: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
}

export interface MappingTemplate {
  oemCode: string;
  lines: MappingTemplateLine[];
}
