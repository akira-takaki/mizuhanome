import dayjs from "dayjs";

import { Config } from "#/config";
import {
  BetRaceResult,
  BetResult,
  makeBetDayResult,
  readBetDayResult,
  tabulateBetDayResult,
  writeBetDayResult,
} from "#/betResult";
import { report } from "#/report";
import { NumbersetInfo } from "#/myUtil";
import { calc3tBet } from "#/boatRace";

async function simulation(): Promise<void> {
  const DATE_FORMAT = "YYYY/MM/DD";

  const config: Config = {
    baseUrl: "",
    email: "",
    accessKey: "",
    capital: 1000000,
    assumedHittingRate: 0.25,
    assumedCollectRate: 1.1,
    assumedAmountPurchasedRate: 0.3,
    assumedEntryRaceCountRate: 0.6,
  };

  // シミュレーションの元になるレースの日付
  const originalDate = dayjs("2021/01/11", DATE_FORMAT);
  const originalBetDayResult = readBetDayResult(originalDate);

  // シミュレーションで書き出すレースの日付
  const simulationDate = dayjs("1999/12/31", DATE_FORMAT);
  const simulationBetDayResult = makeBetDayResult(
    simulationDate,
    config,
    originalBetDayResult.raceCount
  );

  for (let i = 0; i < originalBetDayResult.betRaceResults.length; i++) {
    const originalBetRaceResult = originalBetDayResult.betRaceResults[i];
    const simulationBetRaceResult: BetRaceResult = {
      dataid: originalBetRaceResult.dataid,
      betResults: [],
      isDecision: true,
    };
    simulationBetDayResult.betRaceResults.push(simulationBetRaceResult);

    // シミュレーション用の組番情報を作成
    const numbersetInfos: NumbersetInfo[] = [];
    for (let j = 0; j < originalBetRaceResult.betResults.length; j++) {
      const originalBetResult = originalBetRaceResult.betResults[j];

      if (originalBetResult.type !== "3t") {
        continue;
      }

      numbersetInfos.push({
        numberset: originalBetResult.numberset,
        powers: originalBetResult.powers,
        percent: originalBetResult.percent,
        odds: originalBetResult.preOdds,
        expectedValue: originalBetResult.expectedValue,
      });
    }

    for (let j = 0; j < originalBetRaceResult.betResults.length; j++) {
      const originalBetResult = originalBetRaceResult.betResults[j];

      if (originalBetResult.type !== "3t") {
        continue;
      }

      // シミュレーション用の賭け金を計算
      const bet = calc3tBet(
        numbersetInfos.length,
        numbersetInfos[j],
        simulationBetDayResult
      );

      // レース結果を反映
      const simulationBetResult: BetResult = {
        type: originalBetResult.type,
        numberset: originalBetResult.numberset,
        powers: originalBetResult.powers,
        percent: originalBetResult.percent,
        bet: bet,
        preOdds: originalBetResult.preOdds,
        expectedValue: originalBetResult.expectedValue,
        preDividend: bet * originalBetResult.preOdds,
        odds: originalBetResult.odds,
        dividend:
          originalBetResult.odds !== null ? bet * originalBetResult.odds : 0,
      };
      simulationBetRaceResult.betResults.push(simulationBetResult);
    }
  }

  writeBetDayResult(simulationDate, simulationBetDayResult);
  await tabulateBetDayResult(simulationDate);
  await report(simulationDate);
}

simulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
