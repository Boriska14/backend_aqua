import { SeuilType, Verdict } from '@prisma/client';

export interface SeuilSpec {
  parameterCode: string;
  type: SeuilType;
  minValue: number | null;
  maxValue: number | null;
  isCritical: boolean;
  isMandatory: boolean;
}

export interface MeasuredValueInput {
  parameterCode: string;
  value?: number | null;
  presence?: boolean | null;
}

export interface EvaluatedValue {
  parameterCode: string;
  isCompliant: boolean;
  isCriticalFailure: boolean;
}

export interface VerdictResult {
  verdict: Verdict;
  missingMandatory: string[];
  evaluated: EvaluatedValue[];
}

export function evaluateParameter(
  seuil: SeuilSpec,
  input: MeasuredValueInput,
): boolean {
  if (seuil.type === SeuilType.BACTERIOLOGIQUE) {
    return input.presence === false;
  }

  if (
    input.value === null ||
    input.value === undefined ||
    !Number.isFinite(input.value)
  ) {
    return false;
  }

  if (seuil.minValue !== null && input.value < seuil.minValue) {
    return false;
  }
  if (seuil.maxValue !== null && input.value > seuil.maxValue) {
    return false;
  }
  return true;
}

export function computeVerdict(
  seuils: SeuilSpec[],
  inputs: MeasuredValueInput[],
): VerdictResult {
  const inputMap = new Map<string, MeasuredValueInput>();
  for (const item of inputs) {
    inputMap.set(item.parameterCode.trim().toUpperCase(), item);
  }

  const missingMandatory: string[] = [];
  const evaluated: EvaluatedValue[] = [];
  let hasNonCompliant = false;
  let hasCriticalNonCompliant = false;

  for (const seuil of seuils) {
    const code = seuil.parameterCode.trim().toUpperCase();
    const input = inputMap.get(code);

    const hasMeasurement =
      input !== undefined &&
      (seuil.type === SeuilType.BACTERIOLOGIQUE
        ? typeof input.presence === 'boolean'
        : typeof input.value === 'number' && Number.isFinite(input.value));

    if (!hasMeasurement) {
      if (seuil.isMandatory) {
        missingMandatory.push(code);
      }
      continue;
    }

    const isCompliant = evaluateParameter(seuil, input);
    const isCriticalFailure = !isCompliant && seuil.isCritical;
    if (!isCompliant) {
      hasNonCompliant = true;
    }
    if (isCriticalFailure) {
      hasCriticalNonCompliant = true;
    }

    evaluated.push({
      parameterCode: code,
      isCompliant,
      isCriticalFailure,
    });
  }

  let verdict: Verdict = Verdict.CONFORME;
  if (hasCriticalNonCompliant) {
    verdict = Verdict.NON_CONFORME_GRAVE;
  } else if (hasNonCompliant) {
    verdict = Verdict.NON_CONFORME;
  }

  return {
    verdict,
    missingMandatory,
    evaluated,
  };
}
