const {
  compileDiscordWordUsageOverPeriod,
  bulkCompileData,
} = require("./measureDiscordWordUse");

const funcArgs = [
  {
    start: 2017,
    end: 2021,
  },
  "friend",
  "bromafriendship",
  ["normal", "percentage"],
];

compileDiscordWordUsageOverPeriod(...funcArgs);

// This shows how you can bulk proccess charts already made.
// bulkCompileData(
//   [
//     ["all", "bromabaselinedata"],
//     ["nigger", "bromaracism"],
//     ["fuck you", "bromastressreport"],
//     ["faggot", "bromahomophobia"],
//     ["gf", "bromarelationships"],
//     ["femboy", "bromafaggotry"],
//   ],
//   ["normal", "percentage"]
// );
