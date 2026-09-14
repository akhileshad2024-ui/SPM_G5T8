"use client";

import { useApp } from "@/lib/app-context";
import { WizardSteps } from "@/components/new-request/WizardSteps";
import { StepBasics } from "@/components/new-request/StepBasics";
import { StepRequirements } from "@/components/new-request/StepRequirements";
import { StepRegistration } from "@/components/new-request/StepRegistration";

export default function NewRequestPage() {
  const app = useApp();
  const { step } = app.state;

  return (
    <div style={{ padding: "24px 26px 40px", maxWidth: 920 }}>
      <WizardSteps step={step} />

      <div className="card" style={{ padding: "24px 26px" }}>
        {step === 1 && <StepBasics />}
        {step === 2 && <StepRequirements />}
        {step === 3 && <StepRegistration />}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          <button className="btn btn-ghost" onClick={app.saveDraft}>
            Save as draft
          </button>
          <div style={{ flex: 1 }} />
          {step > 1 && (
            <button className="btn btn-ghost" onClick={app.backStep}>
              Back
            </button>
          )}
          <button className="btn btn-primary" style={{ padding: "0 20px" }} onClick={app.nextStep}>
            {step < 3 ? "Continue" : "Submit for review"}
          </button>
        </div>
      </div>
    </div>
  );
}
