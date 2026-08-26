export type EvaluationReportQuestion = {
  questionNumber: string;
  section?: string | null;
  question: string;
  maxMarks: number;
  awardedMarks: number;
  page?: number | null;
  answerImageUrl?: string | null;
  extractedAnswer?: string | null;
  feedback?: string | null;
  strengths?: string[];
  improvements?: string[];
  correctAnswer?: string | null;
  rubric?: Array<{
    criterion: string;
    maxMarks: number;
    awardedMarks: number;
    feedback?: string | null;
  }>;
  confidence?: number | null;
  requiresReview?: boolean;
};

export type EvaluationReportTemplateData = {
  institute?: {
    name?: string | null;
    logoUrl?: string | null;
  };
  exam: {
    name?: string | null;
    subject?: string | null;
    className?: string | null;
    code?: string | null;
    date?: string | null;
  };
  student: {
    name?: string | null;
    rollNumber?: string | null;
    seatNumber?: string | null;
    className?: string | null;
  };
  summary: {
    totalMarks: number;
    obtainedMarks: number;
    percentage: number;
    correctAnswers: number;
    attemptedQuestions: number;
    reviewQuestions: number;
    result: string;
    evaluatedAt: string;
    overallFeedback?: string | null;
    strengths?: string[];
    improvements?: string[];
  };
  questions: EvaluationReportQuestion[];
};

export function generateEvaluationReportHtml(data: EvaluationReportTemplateData): string {
  const institute = data.institute ?? {};
  const questionsHtml = data.questions.map((question, index) => renderQuestion(question, index)).join("");
  const overallStrengths = renderList(data.summary.strengths, "success-list");
  const overallImprovements = renderList(data.summary.improvements, "warning-list");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(data.exam.name || "Exam Evaluation Report")}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4; margin: 12mm 10mm 14mm; }
    html, body { margin: 0; padding: 0; }
    body {
      background: #ffffff;
      color: #172033;
      font-family: Arial, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Math", sans-serif;
      font-size: 12px;
      line-height: 1.5;
    }
    .report-header {
      background: linear-gradient(135deg, #1f3a5f 0%, #385f71 52%, #2f7d6d 100%);
      border-radius: 12px;
      color: #ffffff;
      margin-bottom: 14px;
      overflow: hidden;
      padding: 22px 24px;
      position: relative;
    }
    .report-header:after {
      background: rgba(255,255,255,0.12);
      border-radius: 999px;
      content: "";
      height: 150px;
      position: absolute;
      right: -48px;
      top: -56px;
      width: 150px;
    }
    .header-top {
      align-items: flex-start;
      display: flex;
      gap: 18px;
      justify-content: space-between;
      position: relative;
      z-index: 1;
    }
    .institute-name { font-size: 13px; margin-bottom: 4px; opacity: 0.9; }
    .report-title { font-size: 24px; font-weight: 700; margin: 0; }
    .exam-name { font-size: 13px; margin-top: 5px; opacity: 0.9; }
    .report-logo { max-height: 52px; max-width: 140px; object-fit: contain; }
    .student-card {
      background: #f7faf9;
      border: 1px solid #dbe5e2;
      border-radius: 10px;
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, 1fr);
      margin-bottom: 14px;
      padding: 14px;
    }
    .info-label, .summary-label, .section-label, .box-heading {
      color: #64748b;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .info-value { color: #0f172a; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
    .summary-grid {
      display: grid;
      gap: 9px;
      grid-template-columns: 1.35fr 1fr 1fr 1fr;
      margin-bottom: 18px;
    }
    .summary-card {
      background: #ffffff;
      border: 1px solid #dbe5e2;
      border-radius: 10px;
      padding: 12px;
    }
    .summary-card.primary {
      background: linear-gradient(135deg, #edf7f4, #f4f7fb);
      border-color: #b7d7cd;
    }
    .summary-value { color: #0f172a; font-size: 22px; font-weight: 700; margin-top: 4px; }
    .summary-value small { color: #64748b; font-size: 12px; }
    .question-card {
      border: 1px solid #dbe5e2;
      border-radius: 10px;
      break-inside: avoid;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .question-header {
      align-items: center;
      background: #f7faf9;
      border-bottom: 1px solid #dbe5e2;
      display: flex;
      justify-content: space-between;
      padding: 12px 14px;
    }
    .question-number { color: #0f172a; font-size: 14px; font-weight: 700; }
    .question-section { color: #64748b; font-size: 10px; margin-top: 2px; }
    .question-score {
      border-radius: 18px;
      font-weight: 700;
      min-width: 74px;
      padding: 5px 10px;
      text-align: center;
    }
    .score-good { background: #dcfce7; color: #166534; }
    .score-average { background: #fef3c7; color: #92400e; }
    .score-poor { background: #fee2e2; color: #991b1b; }
    .score-value { font-size: 16px; }
    .content-block {
      border-bottom: 1px solid #edf2f0;
      padding: 12px 14px;
    }
    .section-label { color: #2f7d6d; }
    .question-text, .student-answer-text, .box-content, .correct-answer-content, .overall-text {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .question-text { color: #172033; font-size: 12.5px; font-weight: 600; }
    .section-title-row { align-items: center; display: flex; justify-content: space-between; }
    .page-badge {
      background: #edf2f0;
      border-radius: 18px;
      color: #64748b;
      font-size: 9px;
      padding: 2px 7px;
    }
    .answer-image-container {
      background: #f7faf9;
      border: 1px dashed #b9c9c4;
      border-radius: 8px;
      margin-top: 7px;
      padding: 8px;
      text-align: center;
    }
    .answer-image {
      background: #ffffff;
      border-radius: 5px;
      display: block;
      margin: auto;
      max-height: 420px;
      max-width: 100%;
      object-fit: contain;
    }
    .student-answer-text {
      background: #f7faf9;
      border-radius: 8px;
      color: #334155;
      padding: 9px;
    }
    .evaluation-grid {
      border-bottom: 1px solid #edf2f0;
      display: grid;
      gap: 10px;
      grid-template-columns: 3fr 1fr;
      padding: 12px 14px;
    }
    .feedback-box, .marks-box {
      background: #ffffff;
      border: 1px solid #dbe5e2;
      border-radius: 8px;
      padding: 10px;
    }
    .feedback-box { background: #f7faf9; }
    .box-content { color: #334155; font-size: 11px; }
    .large-score { color: #2f7d6d; font-size: 25px; font-weight: 700; }
    .large-score span { color: #64748b; font-size: 12px; }
    .score-bar {
      background: #e2e8f0;
      border-radius: 10px;
      height: 5px;
      margin-top: 7px;
      overflow: hidden;
    }
    .score-bar-fill { background: linear-gradient(90deg, #2f7d6d, #467599); height: 100%; }
    .percentage-text { color: #64748b; font-size: 9px; margin-top: 5px; }
    .feedback-list { margin: 5px 0 0; padding-left: 17px; }
    .feedback-list li { margin-bottom: 3px; overflow-wrap: anywhere; }
    .success-label { color: #15803d; }
    .warning-label { color: #b45309; }
    .success-list { color: #166534; }
    .warning-list { color: #92400e; }
    .correct-answer-box {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      margin: 12px 14px;
      overflow: hidden;
    }
    .correct-answer-header {
      border-bottom: 1px solid #a7f3d0;
      color: #047857;
      font-size: 10px;
      font-weight: 700;
      padding: 7px 10px;
      text-transform: uppercase;
    }
    .correct-answer-content { color: #065f46; padding: 10px; }
    .rubric-section { margin: 12px 14px 14px; }
    .rubric-table { border-collapse: collapse; font-size: 10.5px; margin-top: 7px; width: 100%; }
    .rubric-table th {
      background: #f7faf9;
      border: 1px solid #dbe5e2;
      color: #475569;
      padding: 7px;
      text-align: left;
    }
    .rubric-table td {
      border: 1px solid #dbe5e2;
      padding: 7px;
      vertical-align: top;
    }
    .marks-column { text-align: center !important; width: 64px; }
    .criterion { font-weight: 700; overflow-wrap: anywhere; }
    .criterion-feedback { color: #64748b; font-size: 9px; margin-top: 2px; overflow-wrap: anywhere; }
    .overall-feedback {
      background: linear-gradient(135deg, #edf7f4, #f8fafc);
      border: 1px solid #b7d7cd;
      border-radius: 10px;
      break-inside: avoid;
      margin-top: 16px;
      padding: 15px;
    }
    .overall-title { color: #1f3a5f; font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .overall-text { color: #334155; }
    .footer {
      border-top: 1px solid #dbe5e2;
      color: #94a3b8;
      font-size: 9px;
      margin-top: 18px;
      padding-top: 9px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="header-top">
      <div>
        <div class="institute-name">${escapeHtml(institute.name || "Institute Name")}</div>
        <h1 class="report-title">Exam Evaluation Report</h1>
        <div class="exam-name">${escapeHtml(data.exam.name || data.exam.subject || "")}</div>
      </div>
      ${institute.logoUrl ? `<img src="${escapeHtml(institute.logoUrl)}" class="report-logo" />` : ""}
    </div>
  </div>

  <div class="student-card">
    ${renderInfo("Student", data.student.name || "-")}
    ${renderInfo("Roll / Seat No.", data.student.rollNumber || data.student.seatNumber || "-")}
    ${renderInfo("Class", data.student.className || data.exam.className || "-")}
    ${renderInfo("Subject", data.exam.subject || "-")}
    ${renderInfo("Exam Date", data.exam.date || "-")}
    ${renderInfo("Exam Code", data.exam.code || "-")}
    ${renderInfo("Evaluated On", data.summary.evaluatedAt)}
    ${renderInfo("Result", data.summary.result)}
  </div>

  <div class="summary-grid">
    <div class="summary-card primary">
      <div class="summary-label">Overall Score</div>
      <div class="summary-value">${formatNumber(data.summary.obtainedMarks)} <small>/ ${formatNumber(data.summary.totalMarks)}</small></div>
    </div>
    ${renderSummaryCard("Percentage", `${formatNumber(data.summary.percentage)}%`)}
    ${renderSummaryCard("Attempted", formatNumber(data.summary.attemptedQuestions))}
    ${renderSummaryCard("Needs Review", formatNumber(data.summary.reviewQuestions))}
  </div>

  ${questionsHtml}

  ${data.summary.overallFeedback || overallStrengths || overallImprovements ? `
    <div class="overall-feedback">
      <div class="overall-title">Overall Evaluation</div>
      ${data.summary.overallFeedback ? `<div class="overall-text">${escapeHtml(data.summary.overallFeedback)}</div>` : ""}
      ${overallStrengths ? `<div class="section-label success-label" style="margin-top:10px">Strengths</div>${overallStrengths}` : ""}
      ${overallImprovements ? `<div class="section-label warning-label" style="margin-top:10px">Areas for Improvement</div>${overallImprovements}` : ""}
    </div>
  ` : ""}

  <div class="footer">AI-assisted evaluation report - Final marks may be reviewed by the evaluator</div>
</body>
</html>`;
}

function renderQuestion(question: EvaluationReportQuestion, index: number): string {
  const percentage = question.maxMarks > 0 ? Math.round((question.awardedMarks / question.maxMarks) * 100) : 0;
  const strengthsHtml = renderList(question.strengths, "success-list");
  const improvementsHtml = renderList(question.improvements, "warning-list");
  const rubricHtml = renderRubric(question);

  return `<section class="question-card">
    <div class="question-header">
      <div>
        <div class="question-number">Question ${escapeHtml(question.questionNumber || String(index + 1))}</div>
        ${question.section ? `<div class="question-section">${escapeHtml(question.section)}</div>` : ""}
      </div>
      <div class="question-score ${scoreClass(percentage)}">
        <span class="score-value">${formatNumber(question.awardedMarks)}</span>
        <span>/ ${formatNumber(question.maxMarks)}</span>
      </div>
    </div>

    <div class="content-block">
      <div class="section-label">Question</div>
      <div class="question-text">${escapeHtml(question.question || "Question text unavailable.")}</div>
    </div>

    ${question.answerImageUrl ? `
      <div class="content-block">
        <div class="section-title-row">
          <div class="section-label">Student Handwritten Answer</div>
          ${question.page ? `<span class="page-badge">Page ${question.page}</span>` : ""}
        </div>
        <div class="answer-image-container">
          <img src="${escapeHtml(question.answerImageUrl)}" class="answer-image" />
        </div>
      </div>
    ` : ""}

    ${question.extractedAnswer ? `
      <div class="content-block">
        <div class="section-label">Extracted Answer</div>
        <div class="student-answer-text">${escapeHtml(question.extractedAnswer)}</div>
      </div>
    ` : ""}

    <div class="evaluation-grid">
      <div class="feedback-box">
        <div class="box-heading">Evaluation Feedback</div>
        <div class="box-content">${escapeHtml(question.feedback || "No feedback available.")}</div>
      </div>
      <div class="marks-box">
        <div class="box-heading">Marks</div>
        <div class="large-score">${formatNumber(question.awardedMarks)} <span>/ ${formatNumber(question.maxMarks)}</span></div>
        <div class="score-bar"><div class="score-bar-fill" style="width:${clamp(percentage, 0, 100)}%"></div></div>
        <div class="percentage-text">${formatNumber(percentage)}% score</div>
      </div>
    </div>

    ${strengthsHtml ? `<div class="content-block"><div class="section-label success-label">What Is Done Well</div>${strengthsHtml}</div>` : ""}
    ${improvementsHtml ? `<div class="content-block"><div class="section-label warning-label">Areas for Improvement</div>${improvementsHtml}</div>` : ""}

    ${question.correctAnswer ? `
      <div class="correct-answer-box">
        <div class="correct-answer-header">Expected / Correct Answer</div>
        <div class="correct-answer-content">${escapeHtml(question.correctAnswer)}</div>
      </div>
    ` : ""}

    ${rubricHtml}
  </section>`;
}

function renderInfo(label: string, value: string | number): string {
  return `<div><div class="info-label">${escapeHtml(label)}</div><div class="info-value">${escapeHtml(value)}</div></div>`;
}

function renderSummaryCard(label: string, value: string): string {
  return `<div class="summary-card"><div class="summary-label">${escapeHtml(label)}</div><div class="summary-value">${escapeHtml(value)}</div></div>`;
}

function renderList(items: string[] | undefined, className: string): string {
  const cleanItems = (items ?? []).filter((item) => item.trim().length > 0);
  if (cleanItems.length === 0) return "";
  return `<ul class="feedback-list ${className}">${cleanItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderRubric(question: EvaluationReportQuestion): string {
  if (!question.rubric?.length) return "";
  return `<div class="rubric-section">
    <div class="section-label">Rubric Evaluation</div>
    <table class="rubric-table">
      <thead>
        <tr>
          <th>Criterion</th>
          <th class="marks-column">Max</th>
          <th class="marks-column">Awarded</th>
        </tr>
      </thead>
      <tbody>
        ${question.rubric.map((item) => `
          <tr>
            <td>
              <div class="criterion">${escapeHtml(item.criterion)}</div>
              ${item.feedback ? `<div class="criterion-feedback">${escapeHtml(item.feedback)}</div>` : ""}
            </td>
            <td class="marks-column">${formatNumber(item.maxMarks)}</td>
            <td class="marks-column"><strong>${formatNumber(item.awardedMarks)}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </div>`;
}

function scoreClass(percentage: number): string {
  if (percentage >= 75) return "score-good";
  if (percentage >= 40) return "score-average";
  return "score-poor";
}

function formatNumber(value: number | string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
