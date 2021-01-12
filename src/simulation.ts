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
import { NumbersetInfo, TicketType } from "#/myUtil";
import { Ticket } from "#/api";
import { addTicket3t2 } from "#/boatRace";

async function simulation(): Promise<void> {
  const DATE_FORMAT = "YYYY/MM/DD";

  const config: Config = {
    baseUrl: "",
    email: "",
    accessKey: "",
    capital: 1000000,
    assumedHittingRate: 0.25,
    assumedCollectRate: 1.1,
    assumedAmountPurchasedRate: 0.25,
    assumedEntryRaceCountRate: 0.2,
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

    const type: TicketType = "3t";
    const ticket: Ticket = {
      type: type,
      numbers: [],
    };

    // 購入する三連単の舟券を追加する
    addTicket3t2(simulationBetDayResult, numbersetInfos, ticket);

    if (ticket.numbers.length <= 0) {
      continue;
    }

    for (let j = 0; j < originalBetRaceResult.betResults.length; j++) {
      const originalBetResult = originalBetRaceResult.betResults[j];

      if (originalBetResult.type !== "3t") {
        continue;
      }

      // 賭け金を取り出す
      let bet = 0;
      for (let k = 0; k < ticket.numbers.length; k++) {
        if (originalBetResult.numberset === ticket.numbers[k].numberset) {
          bet = ticket.numbers[k].bet;
        }
      }

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
