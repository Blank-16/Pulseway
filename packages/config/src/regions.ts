/**
 * Supported check regions. Each region runs an independent worker fleet
 * that only processes jobs whose `region` field matches WORKER_REGION.
 *
 * Deploying workers in multiple regions provides geographic redundancy:
 * if one AWS region has connectivity issues, other regions continue checking.
 */
export const SUPPORTED_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'ap-southeast-1',
  'ap-northeast-1',
] as const;

export type CheckRegion = typeof SUPPORTED_REGIONS[number];

export function isValidRegion(region: string): region is CheckRegion {
  return (SUPPORTED_REGIONS as readonly string[]).includes(region);
}
