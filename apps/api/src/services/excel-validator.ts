import type {
  ExcelRow,
  ThinkingEntry,
  ValidationIssue,
  ValidationResult,
} from "@guardrails/shared";

export type OnThinking = (entry: ThinkingEntry) => void;

/**
 * Validate parsed Excel rows: structural checks, required columns, per-row data.
 * Emits thinking entries for each check via the onThinking callback.
 */
export async function validateRows(
  rows: ExcelRow[],
  onThinking?: OnThinking,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // ── Structural checks ──
  onThinking?.({
    stage: "validating",
    message: "Checking file structure...",
    status: "info",
  });

  if (rows.length === 0) {
    issues.push({
      message: "No data rows found in file",
      severity: "error",
    });
    onThinking?.({
      stage: "validating",
      message: "No data rows found",
      status: "fail",
    });
    return { valid: false, issues, totalRows: 0 };
  }

  onThinking?.({
    stage: "validating",
    subject: "structure",
    message: `Found ${rows.length} data rows`,
    status: "pass",
  });

  // Check for fully-empty rows in the middle
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const allEmpty = Object.values(row).every((v) => !v || !v.trim());
    if (allEmpty) {
      issues.push({
        row: i + 2,
        message: `Row ${i + 2} is completely empty`,
        severity: "warning",
      });
      onThinking?.({
        stage: "validating",
        subject: `Row ${i + 2}`,
        message: `Row ${i + 2} is completely empty`,
        status: "warn",
      });
    }
  }

  // ── Required columns check ──
  onThinking?.({
    stage: "validating",
    message: "Checking required columns...",
    status: "info",
  });

  const requiredFields: Array<{ field: keyof ExcelRow; label: string }> = [
    { field: "markets", label: "Markets" },
    { field: "channel", label: "Channel" },
    { field: "budget", label: "Budget" },
    { field: "startDate", label: "Start Date" },
    { field: "endDate", label: "End Date" },
  ];

  for (const { field, label } of requiredFields) {
    const hasAnyValue = rows.some((r) => r[field] && r[field].trim());
    if (!hasAnyValue) {
      issues.push({
        field,
        message: `Column "${label}" has no values in any row`,
        severity: "error",
      });
      onThinking?.({
        stage: "validating",
        subject: label,
        message: `Column "${label}" is entirely empty`,
        status: "fail",
      });
    } else {
      onThinking?.({
        stage: "validating",
        subject: label,
        message: `Column "${label}" has data`,
        status: "pass",
      });
    }
  }

  // ── Per-row validation ──
  onThinking?.({
    stage: "validating",
    message: "Validating individual rows...",
    status: "info",
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // Excel row number (1-indexed header + data)
    let rowValid = true;

    // Markets non-empty
    if (!row.markets || !row.markets.trim()) {
      issues.push({
        row: rowNum,
        field: "markets",
        message: `Row ${rowNum}: Markets is empty`,
        severity: "error",
      });
      rowValid = false;
    }

    // Channel non-empty and must be Meta
    if (!row.channel || !row.channel.trim()) {
      issues.push({
        row: rowNum,
        field: "channel",
        message: `Row ${rowNum}: Channel is empty`,
        severity: "error",
      });
      rowValid = false;
    } else if (!row.channel.trim().toLowerCase().startsWith("meta")) {
      issues.push({
        row: rowNum,
        field: "channel",
        message: `Row ${rowNum}: Channel "${row.channel}" is not supported — only Meta campaigns are currently supported`,
        severity: "warning",
      });
    }

    // Budget is valid positive number (if present)
    if (row.budget && row.budget.trim()) {
      const budgetNum = Number(row.budget.replace(/[,\s]/g, ""));
      if (isNaN(budgetNum) || budgetNum <= 0) {
        issues.push({
          row: rowNum,
          field: "budget",
          message: `Row ${rowNum}: Budget "${row.budget}" is not a valid positive number`,
          severity: "error",
        });
        rowValid = false;
      }
    }

    // Dates are valid, start >= today, and end > start
    if (row.startDate && row.startDate.trim()) {
      const start = new Date(row.startDate);
      if (isNaN(start.getTime())) {
        issues.push({
          row: rowNum,
          field: "startDate",
          message: `Row ${rowNum}: Start date "${row.startDate}" is not a valid date`,
          severity: "error",
        });
        rowValid = false;
      } else {
        // Start date must be today or in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (start < today) {
          issues.push({
            row: rowNum,
            field: "startDate",
            message: `Row ${rowNum}: Start date "${row.startDate}" is in the past`,
            severity: "error",
          });
          rowValid = false;
        }
      }

      if (row.endDate && row.endDate.trim()) {
        const end = new Date(row.endDate);
        if (isNaN(end.getTime())) {
          issues.push({
            row: rowNum,
            field: "endDate",
            message: `Row ${rowNum}: End date "${row.endDate}" is not a valid date`,
            severity: "error",
          });
          rowValid = false;
        } else if (!isNaN(start.getTime()) && end <= start) {
          issues.push({
            row: rowNum,
            field: "endDate",
            message: `Row ${rowNum}: End date must be after start date`,
            severity: "error",
          });
          rowValid = false;
        }
      }
    }

    onThinking?.({
      stage: "validating",
      subject: `Row ${rowNum}`,
      message: rowValid
        ? `Row ${rowNum}: OK — ${row.markets}, ${row.channel}`
        : `Row ${rowNum}: Has validation errors`,
      status: rowValid ? "pass" : "fail",
    });
  }

  const hasErrors = issues.some((i) => i.severity === "error");

  onThinking?.({
    stage: "validating",
    message: hasErrors
      ? `Validation failed: ${issues.filter((i) => i.severity === "error").length} errors found`
      : `Validation passed: ${rows.length} rows OK`,
    status: hasErrors ? "fail" : "pass",
  });

  return {
    valid: !hasErrors,
    issues,
    totalRows: rows.length,
  };
}
