export const MAX_ITEM_IMPORT_ROWS = 500;
export const MAX_ITEM_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export interface ItemImportData {
  name: string;
  sku: string;
  itemType: string;
  rate: string;
  unit: string;
  taxRate: string;
  cost: string;
  reorderPoint: string;
}

export interface ItemImportRow {
  rowNumber: number;
  data: ItemImportData;
}
