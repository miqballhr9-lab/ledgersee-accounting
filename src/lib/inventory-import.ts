export const MAX_INVENTORY_COUNT_ROWS = 500;
export const MAX_INVENTORY_COUNT_FILE_BYTES = 5 * 1024 * 1024;

export interface InventoryCountRow {
  itemId: string;
  quantity: string;
}
