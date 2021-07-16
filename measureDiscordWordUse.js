const fs = require("fs");
const axios = require("axios");
const Queue = require("queue-promise");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");

dayjs.extend(utc);

const E = { START: 0, END: 1 };

const DISCORD_EPOCH = 1420070400000;
const SNOWFLAKE_MAGIC_NUMBER = 4194304;

const {
  DATA_FOLDER_PATH,
  REQUEST_MONTHS_CONCURRENT,
  REQUEST_MONTHS_INTERVAL_SECONDS,
  REQUEST_YEARS_CONCURRENT,
  REQUEST_YEARS_INTERVAL_SECONDS,
  DISCORD_GUILD_ID,
  DISCORD_REQUEST_HEADERS,
  DISCORD_REQUEST_REFERRER,
} = require("./settings.json");

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const getFolderDir = (reportId) => `.${DATA_FOLDER_PATH}${reportId}/`;

const writeDataToFile = async (data, filename, reportid) => {
  const reportFolder = getFolderDir(reportid);
  fs.existsSync(reportFolder) || fs.mkdirSync(reportFolder);
  return fs.writeFileSync(
    `${reportFolder}${filename}.csv`,
    data,
    console.error
  );
};

const formatDataToCSV = (data) =>
  data
    .reduce(
      ([acc_month, acc_data], [month, data]) => [
        [...acc_month, monthNames[month - 1]],
        [...acc_data, data],
      ],
      [[], []]
    )
    .map((dataset) => dataset.join(","))
    .join("\n");

const callOnQueue = async (promise_queue, interval, concurrent) =>
  new Promise((resolve) => {
    const queue = new Queue({ concurrent, interval: interval * 1000 });
    const returnList = [];
    queue.add(promise_queue);
    queue.on("resolve", (data) => returnList.push(data));
    queue.on("end", () => resolve(returnList));
  });

const dateToSnowflake = (unix_date) =>
  (unix_date - DISCORD_EPOCH) * SNOWFLAKE_MAGIC_NUMBER;

const allMonthsInYear = (year) =>
  Array.from({ length: 12 }, (_, index) => {
    const firstMonth = dayjs
      .utc()
      .set("year", year)
      .set("month", index)
      .set("date", 1)
      .set("hour", 0)
      .set("minute", 0)
      .set("seconds", 0);
    return [firstMonth, firstMonth.add(1, "month")];
  });

const countDiscordServerMessagesInPeriod = async (
  startDate,
  endDate,
  content,
  author,
  year
) =>
  new Promise(async (resolve, reject) => {
    try {
      const res = await axios(
        `https://discord.com/api/v9/guilds/${DISCORD_GUILD_ID}/messages/search`,
        {
          headers: DISCORD_REQUEST_HEADERS,
          referrer: DISCORD_REQUEST_REFERRER,
          referrerPolicy: "strict-origin-when-cross-origin",
          params: {
            max_id: endDate,
            min_id: startDate,
            ...(content !== "all" && { content }),
            ...(author && { author_id: author }),
          },
          method: "GET",
          mode: "cors",
        }
      );
      res &&
        res.data.total_results !== null &&
        console.log("Year:", year, "| Fetched:", res.data.total_results);
      resolve(res);
    } catch (e) {
      console.error(
        e.response.data,
        `\n\n>>> RETRY AFTER: ${e.response.headers["retry-after"]} seconds.\n\n`,
        dayjs().format()
      );
      reject(e.response.data);
    }
  });

const getDiscordWordOccurancesYear = async (year, word, author, fileid) => {
  const monthUnixListSnowflake = allMonthsInYear(year).map(([start, end]) => [
    dateToSnowflake(+start),
    dateToSnowflake(+end),
    year,
  ]);
  const requestPromiseList = monthUnixListSnowflake.map(
    ([start, end, year]) =>
      () =>
        countDiscordServerMessagesInPeriod(start, end, word, author, year)
  );
  const responsePromises = await callOnQueue(
    requestPromiseList,
    REQUEST_MONTHS_INTERVAL_SECONDS,
    REQUEST_MONTHS_CONCURRENT
  );
  const responseList = responsePromises
    .map((res) =>
      res.data
        ? res.data.total_results === null
          ? "?"
          : res.data.total_results
        : console.log("REQUEST FAILED:", res) && null
    )
    .map((numbers, index) => [index + 1, numbers]);
  const formattedData = formatDataToCSV(responseList);
  const datasheetFileName = `${fileid}-${year}-${word}`;
  await writeDataToFile(formattedData, datasheetFileName, fileid);
  console.log(
    "\nFINISHED WRITING '",
    datasheetFileName,
    "' @",
    dayjs().format()
  );
  return responseList;
};

const compileData = (period, term, fileid, calculated) => {
  const { start, end } = period;
  const PERIOD = [start, end];
  const filenameTemplate = `${fileid}-#-${term}`;
  const listedYearsParsed = Array.from(
    { length: PERIOD[E.END] - PERIOD[E.START] + 1 },
    (_, index) => [
      PERIOD[E.START] + index,
      fs.readFileSync(
        `${getFolderDir(fileid)}${filenameTemplate.replace(
          /#/g,
          PERIOD[E.START] + index
        )}.csv`,
        "utf8"
      ),
    ]
  )
    .reduce(
      ([acc_month, acc_value], [year, data]) => [
        [
          acc_month +
            (acc_month === "" ? "" : ",") +
            data
              .split("\n")[0]
              .split(",")
              .map(
                (m) =>
                  `"${m.slice(0, 3)} ${`${year}`.slice(
                    `${year}`.length - 2,
                    `${year}`.length
                  )}"`
              )
              .join(","),
        ],
        [acc_value + (acc_value === "" ? "" : ",") + data.split("\n")[1]],
      ],
      ["", ""]
    )
    .map((d, index) =>
      index
        ? calculated
            .filter((key) => Object.keys(calculatedValuesList).includes(key))
            .map((fn) => calculatedValuesList[fn](d[0]))
            .join("\n")
        : d
    )
    .join("\n");
  writeDataToFile(
    listedYearsParsed,
    `${filenameTemplate.replace(/#/g, `${PERIOD[E.START]}-${PERIOD[E.END]}`)}`,
    fileid
  );
};

const calculatedValuesList = {
  normal: (n) => n,
  percentage: (n) => {
    const historicData = n.split(",");
    const minValue = Math.min(...historicData.filter((n) => n > 0));
    const maxValue = Math.max(...historicData);
    return historicData
      .map((n) =>
        n > 0 ? parseInt(((n - minValue) / (maxValue - minValue)) * 100) : 0
      )
      .join(",");
  },
};

/**
 *
 * Compile usage of a certain term on a Discord server.
 * @typedef {{start: number, end: number}} PeriodYear
 */

/**
 * Compile usage of a certain term on a Discord server.
 *
 * @param {PeriodYear} period - A time period between one year to another.
 * @param {string} term - The search term. Pass "all" to find all entries.
 * @param {string} fileid - Title prefix for the generated spreadsheets.
 * @param {array} calculated - Calculations that will run once the query ends.
 * @param {string=} author - (Discord ID) Shows only the messages from the user.
 */
const compileDiscordWordUsageOverPeriod = async (
  period,
  term,
  fileid,
  calculated,
  author
) => {
  const { start, end } = period;
  const periodsArray = Array.from(
    { length: end - start + 1 },
    (_, i) => start + i
  );
  const yearOccurancesPromises = periodsArray.map(
    (year) => () =>
      new Promise(async (resolve, reject) => {
        try {
          const res = await getDiscordWordOccurancesYear(
            year,
            term,
            author,
            fileid
          );
          resolve(res);
        } catch (e) {
          console.error(e);
          reject(e);
        }
      })
  );
  await callOnQueue(
    yearOccurancesPromises,
    REQUEST_YEARS_INTERVAL_SECONDS,
    REQUEST_YEARS_CONCURRENT
  );
  compileData({ start, end }, term, fileid, calculated);
  console.log("ALL DATA COMPILED @", dayjs().format());
};

const bulkCompileData = (foldersList, calulations) =>
  foldersList
    .map((v) => [{ start: 2017, end: 2021 }, ...v, calulations])
    .forEach((args) => compileData(...args));

module.exports = {
  compileDiscordWordUsageOverPeriod,
  compileData,
  bulkCompileData,
};
