import { FileText } from 'lucide-react';

export default function FinancialStatementViewer() {
  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 text-center">
      <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
      <p className="text-sm font-medium text-gray-700">Financial Statements</p>
      <p className="text-xs text-gray-500 mt-1">
        Generated statements will appear here after End of Month Close completes.
      </p>
    </div>
  );
}
