import { SeuilType, Verdict } from '@prisma/client';
import * as casesData from './verdict-cases.fictif.json';
import { computeVerdict, SeuilSpec } from './verdict.engine';

interface TestCase {
  id: string;
  description: string;
  seuils: Array<{
    parameterCode: string;
    type: SeuilType;
    minValue: number | null;
    maxValue: number | null;
    isCritical: boolean;
    isMandatory: boolean;
  }>;
  values: Array<{
    parameterCode: string;
    value?: number | null;
    presence?: boolean | null;
  }>;
  expectedVerdict: Verdict;
  expectedMissing: string[];
}

describe('VerdictEngine (20 cas FICTIFS)', () => {
  const testCases = (casesData as { cases: TestCase[] }).cases;

  it('loads 20 FICTIF cases', () => {
    expect(testCases).toHaveLength(20);
  });

  it.each(testCases)('$id: $description', (tc) => {
    const result = computeVerdict(tc.seuils as SeuilSpec[], tc.values);
    expect(result.verdict).toBe(tc.expectedVerdict);
    expect(result.missingMandatory).toEqual(tc.expectedMissing);
  });
});
