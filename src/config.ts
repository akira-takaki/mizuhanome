import fs from "fs-extra";
import { Mutex } from "await-semaphore/index";

/**
 * 設定
 */
export interface Config {
  baseUrl: string;
  email: string;
  accessKey: string;

  /** 資金 */
  capital: number;

  /** 仮定の「的中率(パーセント)」 */
  assumedHittingRate: number;

  /** 仮定の「回収金額率(パーセント)」 */
  assumedCollectRate: number;

  /** 仮定の「購入する金額率(パーセント)」 */
  assumedAmountPurchasedRate: number;

  /** 仮定の「参加するレース数率(パーセント)」 */
  assumedEntryRaceCountRate: number;

  /** 二連単の賭け金のデフォルト額 */
  default2tBet: number;
}

const DIR = "./config";
const FILE_PATH = `${DIR}/Config.json`;
const mutex: Mutex = new Mutex();

/**
 * 設定をファイルへ書き出す
 *
 * @param config 設定
 */
export async function writeConfig(config: Config): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    fs.mkdirpSync(DIR);
    fs.writeFileSync(FILE_PATH, JSON.stringify(config, null, 2));
  } finally {
    release();
  }
}

/**
 * 設定をファイルから読み込む
 *
 * @return 設定
 */
export async function readConfig(): Promise<Config> {
  const release: () => void = await mutex.acquire();

  try {
    return JSON.parse(fs.readFileSync(FILE_PATH).toString());
  } finally {
    release();
  }
}
