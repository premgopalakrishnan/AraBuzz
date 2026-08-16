/* ==========================================================================
   AraBuzz — config.js
   Built-in defaults. A parent can change any of this from Settings; changing it
   there only affects THIS device and never touches this file.

   ⚠️  The key below sits in the app and is readable by anyone who can open the
   files. That is a deliberate trade for a closed family circle. If AraBuzz ever
   goes wider, set an "API base URL" in Settings pointing at a small proxy that
   holds the key server-side — the app needs no other change.
   ========================================================================== */
(function (w) {
  'use strict';

  w.CONFIG = {

    /* The key AraBuzz uses if nobody has entered their own. */
    DEFAULT_API_KEY: '',

    DEFAULT_POLICY: 'balanced',

    /* ---------------------------------------------------------------------
       Model policy — different jobs genuinely need different models, and
       matching them properly is where the token saving is.

       Measured on the three real Spell Buzz sheets: Haiku extracted exactly
       the same words, topics and dates as Sonnet, for a quarter of the cost.
       So reading documents, refilling clue variety and writing memory tricks
       all run on Haiku. Building a week's practice material and writing the
       parent's Coach Report are the two jobs where quality shows, and those
       stay on Sonnet.
       --------------------------------------------------------------------- */
    POLICIES: {
      economy: {
        label: 'Economy',
        blurb: 'Cheapest. Good enough for everyday practice; reports are shorter on nuance.',
        models: {
          'read-deck': 'claude-haiku-4-5-20251001',
          'enrich': 'claude-sonnet-5',
          'top-up': 'claude-haiku-4-5-20251001',
          'memory-tricks': 'claude-haiku-4-5-20251001',
          'coach-report': 'claude-sonnet-5',
          'topic-list': 'claude-haiku-4-5-20251001',
          'test': 'claude-haiku-4-5-20251001'
        }
      },
      balanced: {
        label: 'Balanced  (recommended)',
        blurb: 'Fast, cheap models for the mechanical jobs; the strong model where quality shows — building practice material and writing your report.',
        models: {
          'read-deck': 'claude-haiku-4-5-20251001',
          'enrich': 'claude-sonnet-5',
          'top-up': 'claude-haiku-4-5-20251001',
          'memory-tricks': 'claude-haiku-4-5-20251001',
          'coach-report': 'claude-sonnet-5',
          'topic-list': 'claude-sonnet-5',
          'test': 'claude-haiku-4-5-20251001'
        }
      },
      best: {
        label: 'Best quality',
        blurb: 'The sharpest Coach Report and the richest practice material. Roughly three times the cost of Balanced.',
        models: {
          'read-deck': 'claude-sonnet-5',
          'enrich': 'claude-opus-5',
          'top-up': 'claude-sonnet-5',
          'memory-tricks': 'claude-sonnet-5',
          'coach-report': 'claude-opus-5',
          'topic-list': 'claude-opus-5',
          'test': 'claude-haiku-4-5-20251001'
        }
      }
    },

    /* Offered in the advanced override dropdown. */
    MODELS: [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-opus-5',
      'claude-opus-4-8'
    ],

    JOB_LABELS: {
      'read-deck': 'Reading an uploaded sheet',
      'enrich': 'Building a week of practice material',
      'top-up': 'Refilling clue variety',
      'memory-tricks': 'Memory tricks for missed words',
      'coach-report': 'Writing the Coach Report',
      'topic-list': 'Making a list from a topic'
    }
  };
})(window);
