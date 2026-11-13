// Score values. Kept in one place so they are easy to tune, and so a training
// reward can be derived from the same numbers.

export const SCORE = {
  landed: 10,
  departed: 10, // left through the assigned exit fix, high enough
  wrongExit: -10, // departure left elsewhere, or too low
  separationLoss: -20, // per pair, when the loss starts
  missedApproach: -5,
  leftAirspace: -10,
} as const;
