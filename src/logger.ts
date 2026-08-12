import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.body.question_paper_url",
      "req.body.answer_sheet_url",
      "req.body.callback_url",
      "req.body.log_callback_url",
      "authorization",
      "question_paper_url",
      "answer_sheet_url",
      "callback_url",
      "log_callback_url",
      "*.temporary_url",
      "*.url",
      "*.student_name",
      "*.roll_number",
      "*.accessKeyId",
      "*.secretAccessKey"
    ],
    censor: "[redacted]"
  }
});
