import styles from "./WizardSteps.module.css";

const STEPS: Array<[string, 1 | 2 | 3]> = [
  ["Basics", 1],
  ["Requirements", 2],
  ["Registration", 3],
];

export function WizardSteps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className={styles.steps}>
      {STEPS.map(([label, n]) => (
        <div key={n} className={`${styles.step} ${step === n ? styles.stepActive : ""}`}>
          <span
            className={`${styles.stepNumber} ${step === n ? styles.stepNumberActive : step > n ? styles.stepNumberDone : ""}`}
          >
            {n}
          </span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
