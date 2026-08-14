import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PageGuideStep {
  label: string;
  detail: ReactNode;
}

export interface PageGuideProps {
  title: string;
  steps: PageGuideStep[];
  note?: string;
}

export function PageGuide({ title, steps, note }: PageGuideProps) {
  return (
    <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-blue-700 dark:text-blue-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-blue-700/80 dark:text-blue-300/80 space-y-1.5">
        {steps.map((step, i) => (
          <p key={i}>
            <strong>{i + 1}. {step.label}</strong> — {step.detail}
          </p>
        ))}
        {note && (
          <p className="pt-1.5 border-t border-blue-200/60 dark:border-blue-900/60 mt-1.5">{note}</p>
        )}
      </CardContent>
    </Card>
  );
}
