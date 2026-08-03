export interface CorrelationContext {
  workflowRunId: string;
  stageId?: string;
}

export interface MetricSample {
  name: string;
  value: number;
  labels: Record<string, string>;
}

export interface ObservabilityScope {
  info(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  increment(name: string, value?: number, labels?: Record<string, string>): void;
}

export interface FactoryObservability {
  scope(context: CorrelationContext): ObservabilityScope;
}

export class StructuredObservability implements FactoryObservability {
  private readonly samples: MetricSample[] = [];
  private readonly secrets: string[];

  constructor(private readonly options: { sink: (line: string) => void; secrets?: string[] }) {
    this.secrets = (options.secrets ?? []).filter(Boolean).sort((a, b) => b.length - a.length);
  }

  scope(context: CorrelationContext): ObservabilityScope {
    const emit = (level: "info" | "error", event: string, data: Record<string, unknown> = {}) => {
      this.options.sink(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          event,
          ...context,
          data: this.redact(data),
        }),
      );
    };
    return {
      info: (event, data) => emit("info", event, data),
      error: (event, data) => emit("error", event, data),
      increment: (name, value = 1, labels = {}) => {
        this.samples.push({
          name,
          value,
          labels: {
            ...labels,
            workflowRunId: context.workflowRunId,
            ...(context.stageId ? { stageId: context.stageId } : {}),
          },
        });
      },
    };
  }

  metrics(): MetricSample[] {
    return structuredClone(this.samples);
  }

  private redact(value: unknown, key = ""): unknown {
    if (/(token|secret|password|credential|private.?key|api.?key|authorization)/iu.test(key))
      return "[REDACTED]";
    if (typeof value === "string")
      return this.secrets.reduce(
        (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
        value,
      );
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, this.redact(item, name)]),
      );
    return value;
  }
}

export const noOpObservability: FactoryObservability = {
  scope: () => ({
    info: () => {},
    error: () => {},
    increment: () => {},
  }),
};
