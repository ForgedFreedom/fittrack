// Starter library and plans. Fixed ids so two devices seeded separately
// don't create duplicates when they sync.

import { now, dateKey } from './util.js';

const R = { reps: true };
const W = { reps: true, weight: true };
const T = { duration: true };

const EXERCISES = [
  // Core
  ['ex-chair-climber', 'Chair-supported mountain climbers', 'Core', R, false,
    'Hands on a sturdy chair seat (or floor) in a high plank. Drive one knee toward your chest, alternate. Keep hips level and core braced; don\'t let hips sag. Count each knee drive.'],
  ['ex-plank', 'Plank', 'Core', T, false,
    'Forearms under shoulders, body in a straight line from head to heels. Squeeze glutes, brace abs, breathe.'],
  ['ex-oblique-crunch', 'Standing oblique crunch', 'Core', R, true,
    'Standing, hands behind head. Bring knee up and to the side while crunching the same-side elbow down to meet it. Controlled rotation, no momentum.'],
  ['ex-russian-twist', 'Russian twist', 'Core', R, false,
    'Seated, lean back slightly with chest up, feet down (or lifted to make harder). Rotate torso side to side.'],
  // Lower body
  ['ex-squat', 'Bodyweight squats', 'Legs', R, false,
    'Feet shoulder-width, sit back and down, chest up, knees track over toes. Full range you can control.'],
  ['ex-reverse-lunge', 'Reverse lunges', 'Legs', R, true,
    'Step back, lower until both knees are about 90°, push through the front heel to return.'],
  ['ex-glute-kickback', 'Glute kickbacks (donkey kicks)', 'Glutes', R, true,
    'On all fours, keep knee bent and drive the foot up toward the ceiling. Squeeze the glute and pause 1 second at the top.'],
  ['ex-glute-bridge', 'Glute bridge', 'Glutes', R, false,
    'Lying on your back, knees bent, feet flat. Drive hips up, squeeze glutes at the top, lower with control.'],
  ['ex-calf-raise', 'Calf raises', 'Legs', R, false, 'Rise onto the balls of your feet, pause, lower slowly. Hold a wall for balance.'],
  // Upper body
  ['ex-pushups', 'Pushups', 'Upper body', R, false,
    'Hands just outside shoulders, body straight. Lower chest toward floor, press back up. Easier: hands on a bench or knees down.'],
  ['ex-curls', 'Bicep curls', 'Upper body', W, false,
    'Elbows pinned at your sides, curl the weights up, lower slowly (about 2–3 seconds).'],
  ['ex-shoulder-press', 'Shoulder press', 'Upper body', W, false, 'Press weights from shoulder height to overhead without arching your lower back.'],
  ['ex-db-row', 'Dumbbell row', 'Upper body', W, true, 'Hinge forward with a flat back, pull the weight toward your hip, lower with control.'],
  // Stretches & mobility
  ['ex-hamstring-stretch', 'Hamstring stretch', 'Stretch', T, true, 'Leg extended, hinge from the hips with a long spine until you feel the stretch. No bouncing.'],
  ['ex-hip-flexor-stretch', 'Kneeling hip flexor stretch', 'Stretch', T, true, 'Half-kneeling, tuck the pelvis and shift forward gently. Feel it at the front of the back hip.'],
  ['ex-chest-stretch', 'Doorway chest stretch', 'Stretch', T, false, 'Forearms on a door frame, step through gently until you feel the stretch across your chest.'],
  ['ex-childs-pose', "Child's pose", 'Stretch', T, false, 'Knees wide, sit back toward your heels, arms long, breathe into your back.'],
  ['ex-cat-cow', 'Cat-cow', 'Stretch', R, false, 'On all fours, alternate rounding and arching your spine slowly with your breath.'],
  ['ex-march', 'March in place (warm-up)', 'Warm-up', T, false, 'Easy pace, swing the arms. Add arm circles and light torso twists.'],
];

const item = (id, exerciseId, sets, reps, extra = {}) => ({
  id, exerciseId, sets, reps, duration: 0, weight: 0, rest: 45, timer: true, ...extra,
});

export function seedData(state) {
  const t = now();
  for (const [id, name, category, track, perSide, notes] of EXERCISES) {
    state.exercises[id] = {
      id, name, category, perSide, notes, link: '',
      track: { reps: !!track.reps, weight: !!track.weight, duration: !!track.duration },
      updatedAt: t,
    };
  }

  const today = dateKey();

  state.plans['plan-100-daily'] = {
    id: 'plan-100-daily',
    name: '100 Reps Daily',
    description:
      '4 bodyweight moves, about 100 reps each, broken into sets. Ramp: about half the volume in weeks 1–2, then the full 100. Sundays are active recovery (walk, light stretching). Pair with a calorie deficit and plenty of protein for fat loss.',
    active: true,
    days: [1, 2, 3, 4, 5, 6],
    startDate: today,
    ramp: [{ week: 1, pct: 50 }, { week: 3, pct: 100 }],
    items: [
      item('i-100-warm', 'ex-march', 1, 0, { duration: 180, rest: 0 }),
      item('i-100-core', 'ex-chair-climber', 4, 25),
      item('i-100-glute', 'ex-glute-kickback', 5, 10),
      item('i-100-vline', 'ex-oblique-crunch', 5, 10),
      item('i-100-legs', 'ex-squat', 4, 25),
    ],
    updatedAt: t,
  };

  state.plans['plan-strength'] = {
    id: 'plan-strength',
    name: 'Basic Strength',
    description: 'Simple full-body strength, three days a week. Add weight when all sets feel easy.',
    active: false,
    days: [1, 3, 5],
    startDate: today,
    ramp: [],
    items: [
      item('i-str-push', 'ex-pushups', 3, 12, { rest: 60 }),
      item('i-str-squat', 'ex-squat', 3, 15, { rest: 60 }),
      item('i-str-curl', 'ex-curls', 3, 10, { weight: 15, rest: 60 }),
      item('i-str-press', 'ex-shoulder-press', 3, 10, { weight: 10, rest: 60 }),
      item('i-str-plank', 'ex-plank', 2, 0, { duration: 30, rest: 45 }),
    ],
    updatedAt: t,
  };

  state.plans['plan-stretch'] = {
    id: 'plan-stretch',
    name: 'Daily Stretch',
    description: 'About 5 minutes of mobility. Good as a cool-down or on rest days.',
    active: false,
    days: [],
    startDate: today,
    ramp: [],
    items: [
      item('i-st-catcow', 'ex-cat-cow', 1, 10, { rest: 0 }),
      item('i-st-ham', 'ex-hamstring-stretch', 1, 0, { duration: 30, rest: 10 }),
      item('i-st-hip', 'ex-hip-flexor-stretch', 1, 0, { duration: 30, rest: 10 }),
      item('i-st-chest', 'ex-chest-stretch', 1, 0, { duration: 30, rest: 10 }),
      item('i-st-child', 'ex-childs-pose', 1, 0, { duration: 45, rest: 0 }),
    ],
    updatedAt: t,
  };
}
