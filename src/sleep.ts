/**
 * スリープ
 *
 * @param millisecond
 */
export async function sleep(millisecond: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millisecond));
}
