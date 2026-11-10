// Prints a short, friendly summary of the test run and tells the student if the task is approved.
// Tests marked { todo: "bonus" } are bonus tests: they are shown but are not required for approval.

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function messageOf(error) {
  const cause = error?.cause ?? error;
  return String(cause?.message ?? cause).split("\n")[0];
}

export default async function* reporter(source) {
  let passed = 0;
  let failed = 0;
  let bonusPassed = 0;
  let bonusTotal = 0;

  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const { name, details, todo } = event.data;
    if (details?.type === "suite") continue;
    const ok = event.type === "test:pass";

    if (todo) {
      bonusTotal++;
      if (ok) bonusPassed++;
      yield ok ? `  ${yellow("★")} ${name}\n` : `  ${yellow("☆")} ${name} ${yellow("(bonus, not done yet)")}\n`;
      continue;
    }

    if (ok) {
      passed++;
      yield `  ${green("✔")} ${name}\n`;
    } else {
      failed++;
      yield `  ${red("✘")} ${name}\n      ${red("→ " + messageOf(details?.error))}\n`;
    }
  }

  const total = passed + failed;
  yield "\n";
  yield `${bold("Result:")} ${passed}/${total} tests passed`;
  yield bonusTotal ? `, bonus ${bonusPassed}/${bonusTotal}\n` : "\n";

  if (total > 0 && failed === 0) {
    yield green(bold("\n✅ All tests passed - the task is APPROVED! You can move on to the next task.\n"));
    yield green("✅ כל הטסטים עברו - המשימה אושרה! אפשר לעבור למשימה הבאה.\n");
  } else {
    yield red(bold(`\n❌ ${failed} test(s) still failing - the task is not approved yet. Keep going!\n`));
    yield red("❌ עדיין יש טסטים שנכשלים - המשימה עוד לא אושרה. תמשיכו!\n");
  }
}
