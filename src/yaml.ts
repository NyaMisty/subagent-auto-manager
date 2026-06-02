export function toYaml(value: unknown): string {
  const lines = formatValue(value, 0);
  return `${lines.join("\n")}\n`;
}

function formatValue(value: unknown, indent: number): string[] {
  if (Array.isArray(value)) {
    return formatArray(value, indent);
  }

  if (isRecord(value)) {
    return formatObject(value, indent);
  }

  return [`${spaces(indent)}${scalar(value)}`];
}

function formatObject(value: Record<string, unknown>, indent: number): string[] {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [`${spaces(indent)}{}`];
  }

  const lines: string[] = [];
  for (const [key, child] of entries) {
    if (Array.isArray(child) || isRecord(child)) {
      if (isEmptyCollection(child)) {
        lines.push(`${spaces(indent)}${key}: ${Array.isArray(child) ? "[]" : "{}"}`);
      } else {
        lines.push(`${spaces(indent)}${key}:`);
        lines.push(...formatValue(child, indent + 2));
      }
    } else {
      lines.push(`${spaces(indent)}${key}: ${scalar(child)}`);
    }
  }
  return lines;
}

function formatArray(value: unknown[], indent: number): string[] {
  if (value.length === 0) {
    return [`${spaces(indent)}[]`];
  }

  const lines: string[] = [];
  for (const item of value) {
    if (Array.isArray(item) || isRecord(item)) {
      if (isEmptyCollection(item)) {
        lines.push(`${spaces(indent)}- ${Array.isArray(item) ? "[]" : "{}"}`);
      } else {
        lines.push(`${spaces(indent)}-`);
        lines.push(...formatValue(item, indent + 2));
      }
    } else {
      lines.push(`${spaces(indent)}- ${scalar(item)}`);
    }
  }
  return lines;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyCollection(value: unknown[] | Record<string, unknown>): boolean {
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
}

function spaces(count: number): string {
  return " ".repeat(count);
}
