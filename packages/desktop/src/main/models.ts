// Re-export from shared — this file exists for backwards-compatible imports
// within the desktop package. New code should import from @nomnomdrive/shared.
export {
  type ProgressCallback,
  resolveModelPath,
  modelExists,
} from '@nomnomdrive/shared';
