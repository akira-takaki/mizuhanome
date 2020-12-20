/**
 * スリープ
 *
 * @param millisecond
 */
export async function sleepFunc(millisecond: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millisecond));
}
