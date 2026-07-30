function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body || {};
}

const ACTION_LIMITS = Object.freeze({
  ai_request: 600,
  daily_message: 240,
  event_parse: 400,
  energy_patterns: 500,
  analytics_summary: 1200,
  monthly_report: 1400,
  tag_suggest: 300,
  term_explain: 500,
  memo_format: 2400,
  english_question: 2600,
  knowledge_answer: 12000,
  nuance_generate: 12000,
  translation_variants: 9000,
  memo_summary: 700,
  goal_split: 2200,
  batch_tags: 2200,
  planner_action: 1400,
  task_schedule: 4000,
});
const MAX_SYSTEM_CHARS = 32_000;
const MAX_USER_CHARS = 120_000;
const JSON_ACTIONS = new Set([
  'event_parse', 'energy_patterns', 'monthly_report', 'tag_suggest',
  'memo_format', 'english_question', 'knowledge_answer', 'nuance_generate',
  'translation_variants', 'memo_summary', 'goal_split', 'batch_tags',
  'planner_action', 'task_schedule',
]);

function validateRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Invalid JSON request body.'), { status: 400 });
  }
  const actionType = String(body.actionType || 'ai_request');
  const maxAllowed = ACTION_LIMITS[actionType];
  if (!maxAllowed) {
    throw Object.assign(new Error('Unsupported AI action.'), { status: 400 });
  }
  const systemText = String(body.systemText || '');
  const userText = String(body.userText || '');
  if (systemText.length > MAX_SYSTEM_CHARS || userText.length > MAX_USER_CHARS) {
    throw Object.assign(new Error('AI request is too large.'), { status: 413 });
  }
  const requested = Number(body.maxTokens);
  const maxTokens = Number.isFinite(requested)
    ? Math.max(64, Math.min(maxAllowed, Math.trunc(requested)))
    : Math.min(300, maxAllowed);
  return {
    actionType,
    systemText,
    userText,
    maxTokens,
    modelPreference: String(body.modelPreference || ''),
    responseFormat: JSON_ACTIONS.has(actionType)
      ? 'json'
      : (body.responseFormat === 'json' ? 'json' : 'text'),
  };
}

function pickModel(pref) {
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || fastModel;
  const raw = String(pref || '').toLowerCase();
  if (raw.includes('sonnet') || raw === 'quality') return qualityModel;
  return fastModel;
}

function pickThinkingConfig(model, actionType) {
  const complexActions = new Set([
    'analytics_summary',
    'goal_split',
    'monthly_report',
    'planner_action',
    'task_schedule',
    'nuance_generate',
    'translation_variants',
    'english_question',
    'knowledge_answer',
  ]);
  const isComplex = complexActions.has(String(actionType || ''));
  if (String(model).startsWith('gemini-2.5-')) {
    return { thinkingBudget: isComplex ? 2048 : 512 };
  }
  return { thinkingLevel: isComplex ? 'medium' : 'low' };
}

function nullableString(description) {
  return { type: 'STRING', nullable: true, description };
}

function stringArray(description) {
  return { type: 'ARRAY', description, items: { type: 'STRING' } };
}

function getTaskIdsFromPrompt(userText) {
  try {
    const payload = JSON.parse(String(userText || ''));
    return Array.isArray(payload?.tasks)
      ? [...new Set(payload.tasks.map(task => String(task?.id || '')).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function pickResponseSchema(actionType, body) {
  const action = String(actionType || '');
  if (action === 'task_schedule') {
    const taskIds = getTaskIdsFromPrompt(body.userText);
    const taskId = { type: 'STRING', description: 'An exact task id from the supplied tasks array.' };
    if (taskIds.length) taskId.enum = taskIds;
    return {
      type: 'OBJECT',
      properties: {
        scheduleItems: {
          type: 'ARRAY',
          description: 'Non-overlapping task blocks that fit all supplied constraints.',
          items: {
            type: 'OBJECT',
            properties: {
              taskId,
              title: { type: 'STRING', description: 'The supplied task title.' },
              date: { type: 'STRING', description: 'Local date in YYYY-MM-DD format.' },
              startTime: { type: 'STRING', description: 'Local start time in 24-hour HH:MM format.' },
              endTime: { type: 'STRING', description: 'Local end time in 24-hour HH:MM format.' },
              note: { type: 'STRING', description: 'A short placement reason, or an empty string.' },
            },
            required: ['taskId', 'title', 'date', 'startTime', 'endTime', 'note'],
          },
        },
      },
      required: ['scheduleItems'],
    };
  }

  if (action === 'event_parse') {
    return {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Event title using only supplied details.' },
        start: nullableString('Local start datetime in YYYY-MM-DDTHH:mm:00 format, or null.'),
        end: nullableString('Local end datetime in YYYY-MM-DDTHH:mm:00 format, or null.'),
        categoryName: nullableString('One exact supplied category name, or null.'),
        isTentative: { type: 'BOOLEAN', description: 'True only when the event is tentative.' },
      },
      required: ['title', 'start', 'end', 'categoryName', 'isTentative'],
    };
  }

  if (action === 'planner_action') {
    return {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['task', 'event', 'schedule', 'memo', 'database', 'delete_event', 'delete_task', 'delete_memo'],
        },
        title: { type: 'STRING' },
        targetTitle: { type: 'STRING' },
        date: nullableString('Local date in YYYY-MM-DD format, or null.'),
        startTime: nullableString('Local start time in HH:MM format, or null.'),
        endTime: nullableString('Local end time in HH:MM format, or null.'),
        dueDate: nullableString('Local due date in YYYY-MM-DD format, or null.'),
        dueTime: nullableString('Local due time in HH:MM format, or null.'),
        weight: { type: 'STRING', enum: ['large', 'medium', 'small'] },
        categoryName: nullableString('One exact supplied category name, or null.'),
        isTentative: { type: 'BOOLEAN' },
        estimatedMinutes: { type: 'INTEGER', nullable: true, minimum: 1, maximum: 1440 },
        tags: stringArray('Only tags supported by the user input or supplied context.'),
        memo: { type: 'STRING' },
        blocks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING', enum: ['paragraph', 'h2', 'bullet'] },
              text: { type: 'STRING' },
            },
            required: ['type', 'text'],
          },
        },
        fields: stringArray('Database field labels.'),
        rows: { type: 'ARRAY', items: { type: 'OBJECT' } },
        message: { type: 'STRING' },
      },
      required: [
        'action', 'title', 'targetTitle', 'date', 'startTime', 'endTime',
        'dueDate', 'dueTime', 'weight', 'categoryName', 'isTentative',
        'estimatedMinutes', 'tags', 'memo',
        'blocks', 'fields', 'rows', 'message',
      ],
    };
  }

  if (action === 'memo_format') {
    return {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'A short Japanese title grounded in the memo.' },
        blocks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING', enum: ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'toggle', 'math', 'divider'] },
              text: { type: 'STRING' },
            },
            required: ['type', 'text'],
          },
        },
        tags: stringArray('Up to five short Japanese topic tags grounded in the memo.'),
      },
      required: ['title', 'blocks', 'tags'],
    };
  }

  if (action === 'memo_summary') {
    return {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'A Japanese summary grounded only in the supplied text.' },
        tags: stringArray('Short Japanese topic tags grounded in the supplied text.'),
      },
      required: ['summary', 'tags'],
    };
  }

  if (action === 'tag_suggest') {
    return { type: 'OBJECT', properties: { tags: stringArray('Up to five short Japanese topic tags.') }, required: ['tags'] };
  }

  if (action === 'nuance_generate') {
    return {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: 'A concise Japanese category for the whole expression set.',
        },
        topic: {
          type: 'STRING',
          description: 'A concise Japanese semantic theme for the whole expression set.',
        },
        entries: {
          type: 'ARRAY',
          description: 'Three to five distinct expressions for the requested topic.',
          minItems: 3,
          maxItems: 5,
          items: {
            type: 'OBJECT',
            properties: {
              term: { type: 'STRING' },
              lemma: { type: 'STRING' },
              pronunciationIpa: { type: 'STRING' },
              aliases: stringArray('Inflected forms or useful spelling variants.'),
              senseId: { type: 'STRING' },
              partOfSpeech: { type: 'STRING' },
              etymologyJa: { type: 'STRING' },
              coreImageJa: { type: 'STRING' },
              coreMeaningJa: { type: 'STRING' },
              nuanceJa: { type: 'STRING' },
              nuanceTypeJa: { type: 'STRING' },
              register: { type: 'STRING' },
              intensityLevel: {
                type: 'INTEGER',
                minimum: 1,
                maximum: 5,
              },
              intensity: { type: 'STRING' },
              emotionalToneJa: { type: 'STRING' },
              useCasesJa: stringArray('Concrete situations where this expression is natural.'),
              collocations: stringArray('Common short collocations in the target language.'),
              examples: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    source: { type: 'STRING' },
                    translation: { type: 'STRING' },
                    noteJa: { type: 'STRING' },
                  },
                  required: ['source', 'translation', 'noteJa'],
                },
              },
              comparisons: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    term: { type: 'STRING' },
                    differenceJa: { type: 'STRING' },
                  },
                  required: ['term', 'differenceJa'],
                },
              },
              cautionsJa: stringArray('Usage cautions, including grammar or register differences.'),
              grammarNotes: {
                type: 'OBJECT',
                properties: {
                  partOfSpeech: { type: 'STRING' },
                  countability: { type: 'STRING' },
                  plural: { type: 'STRING' },
                  past: { type: 'STRING' },
                  pastParticiple: { type: 'STRING' },
                  usageNotes: stringArray('Only useful grammar or countability cautions.'),
                  exampleForms: stringArray('Irregular or otherwise noteworthy forms.'),
                },
                required: [
                  'partOfSpeech',
                  'countability',
                  'plural',
                  'past',
                  'pastParticiple',
                  'usageNotes',
                  'exampleForms',
                ],
              },
            },
            required: [
              'term',
              'lemma',
              'pronunciationIpa',
              'aliases',
              'senseId',
              'partOfSpeech',
              'etymologyJa',
              'coreImageJa',
              'coreMeaningJa',
              'nuanceJa',
              'nuanceTypeJa',
              'register',
              'intensityLevel',
              'intensity',
              'emotionalToneJa',
              'useCasesJa',
              'collocations',
              'examples',
              'comparisons',
              'cautionsJa',
              'grammarNotes',
            ],
          },
        },
      },
      required: ['category', 'topic', 'entries'],
    };
  }

  if (action === 'translation_variants') {
    return {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: 'A concise Japanese category for the source sentence.',
        },
        topic: {
          type: 'STRING',
          description: 'A concise Japanese semantic theme for the source sentence.',
        },
        variants: {
          type: 'ARRAY',
          description: 'Exactly three meaningfully different, natural English translations in the requested style order.',
          minItems: 3,
          maxItems: 3,
          items: {
            type: 'OBJECT',
            properties: {
              style: {
                type: 'STRING',
                enum: ['standard_faithful', 'natural_conversational', 'expressive_polished'],
              },
              translation: { type: 'STRING' },
              backTranslationJa: {
                type: 'STRING',
                description: 'A natural Japanese back-translation that makes any semantic shift visible.',
              },
              overallNuanceJa: {
                type: 'STRING',
                description: 'A Japanese explanation of the overall impression and suitable situation.',
              },
              register: { type: 'STRING' },
              vocabularyNotes: {
                type: 'ARRAY',
                description: 'Two to four important vocabulary or construction notes.',
                items: {
                  type: 'OBJECT',
                  properties: {
                    expression: { type: 'STRING' },
                    lemma: { type: 'STRING' },
                    senseHintJa: { type: 'STRING' },
                    etymologyJa: { type: 'STRING' },
                    coreImageJa: { type: 'STRING' },
                    nuanceJa: { type: 'STRING' },
                  },
                  required: ['expression', 'lemma', 'senseHintJa', 'etymologyJa', 'coreImageJa', 'nuanceJa'],
                },
              },
              comparisons: {
                type: 'ARRAY',
                description: 'Concrete comparisons with similar English expressions.',
                items: {
                  type: 'OBJECT',
                  properties: {
                    expression: { type: 'STRING' },
                    alternative: { type: 'STRING' },
                    differenceJa: { type: 'STRING' },
                  },
                  required: ['expression', 'alternative', 'differenceJa'],
                },
              },
            },
            required: [
              'style',
              'translation',
              'backTranslationJa',
              'overallNuanceJa',
              'register',
              'vocabularyNotes',
              'comparisons',
            ],
          },
        },
      },
      required: ['category', 'topic', 'variants'],
    };
  }

  if (action === 'english_question') {
    return {
      type: 'OBJECT',
      properties: {
        shortAnswerJa: { type: 'STRING', description: 'A direct Japanese answer in two or three sentences.' },
        intuitionJa: { type: 'STRING', description: 'A short core image or intuitive explanation.' },
        explanationJa: { type: 'STRING', description: 'A careful Japanese explanation with the relevant grammar or usage distinctions.' },
        examples: {
          type: 'ARRAY',
          minItems: 2,
          maxItems: 3,
          items: {
            type: 'OBJECT',
            properties: {
              english: { type: 'STRING' },
              japanese: { type: 'STRING' },
              noteJa: { type: 'STRING' },
            },
            required: ['english', 'japanese', 'noteJa'],
          },
        },
        relatedTerms: stringArray('English words, phrases, or grammar labels worth linking to the learner library.'),
        cautionsJa: stringArray('Only important caveats, exceptions, or ambiguity notes.'),
        suggestedCategory: { type: 'STRING', description: 'One of vocabulary, phrasal verb, preposition, conjunction, grammar, or usage.' },
      },
      required: ['shortAnswerJa', 'intuitionJa', 'explanationJa', 'examples', 'relatedTerms', 'cautionsJa', 'suggestedCategory'],
    };
  }

  if (action === 'knowledge_answer') {
    const segment = {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING' },
        marks: {
          type: 'ARRAY',
          items: {
            type: 'STRING',
            enum: ['strong', 'highlight-yellow', 'highlight-blue', 'warning'],
          },
        },
        conceptKey: { type: 'STRING', description: 'A related concept key, or an empty string.' },
      },
      required: ['text', 'marks', 'conceptKey'],
    };
    const concept = {
      type: 'OBJECT',
      properties: {
        key: { type: 'STRING', description: 'Stable lowercase concept key, preferably ASCII kebab-case.' },
        label: { type: 'STRING', description: 'Natural Japanese display label.' },
        aliases: stringArray('Useful Japanese or English alternate names.'),
        role: { type: 'STRING', enum: ['primary', 'related'] },
      },
      required: ['key', 'label', 'aliases', 'role'],
    };
    return {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'A concise editable Japanese title.' },
        classification: {
          type: 'OBJECT',
          properties: {
            majorId: { type: 'STRING' },
            middleId: { type: 'STRING' },
            specialty: { type: 'STRING' },
            relatedCategoryIds: {
              type: 'ARRAY',
              maxItems: 3,
              items: { type: 'STRING' },
            },
          },
          required: ['majorId', 'middleId', 'specialty', 'relatedCategoryIds'],
        },
        primaryConcept: concept,
        concepts: { type: 'ARRAY', items: concept },
        facets: {
          type: 'OBJECT',
          properties: {
            periods: stringArray('Relevant periods or dates.'),
            regions: stringArray('Relevant places or regions.'),
            people: stringArray('Relevant people.'),
            organizations: stringArray('Relevant organizations.'),
            works: stringArray('Relevant works or source materials.'),
            systems: stringArray('Relevant institutions or systems.'),
          },
          required: ['periods', 'regions', 'people', 'organizations', 'works', 'systems'],
        },
        timeline: {
          type: 'OBJECT',
          properties: {
            mode: { type: 'STRING', enum: ['timeless', 'cross_period', 'dated', 'unclassified'] },
            startYear: { type: 'INTEGER', nullable: true, minimum: -5000, maximum: 3000 },
            endYear: { type: 'INTEGER', nullable: true, minimum: -5000, maximum: 3000 },
            precision: { type: 'STRING', enum: ['year', 'decade', 'century', 'range'] },
            label: { type: 'STRING' },
          },
          required: ['mode', 'startYear', 'endYear', 'precision', 'label'],
        },
        geography: {
          type: 'OBJECT',
          properties: {
            scope: { type: 'STRING', enum: ['global', 'regional', 'country', 'unclassified'] },
            regionIds: stringArray('Only supplied region ids.'),
            countryCodes: stringArray('ISO 3166-1 alpha-2 codes only.'),
          },
          required: ['scope', 'regionIds', 'countryCodes'],
        },
        answer: {
          type: 'OBJECT',
          properties: {
            directAnswer: { type: 'ARRAY', items: segment },
            sections: {
              type: 'ARRAY',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'OBJECT',
                properties: {
                  heading: { type: 'STRING', description: 'Content-specific heading, or an empty string.' },
                  paragraphs: {
                    type: 'ARRAY',
                    minItems: 1,
                    items: { type: 'ARRAY', items: segment },
                  },
                },
                required: ['heading', 'paragraphs'],
              },
            },
            cautions: stringArray('Only genuine uncertainty, disputed points, or important caveats.'),
          },
          required: ['directAnswer', 'sections', 'cautions'],
        },
      },
      required: ['title', 'classification', 'primaryConcept', 'concepts', 'facets', 'timeline', 'geography', 'answer'],
    };
  }

  return null;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part?.text || '').join('').trim();
}

function extractGeminiIssue(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) return `Gemini blocked the request: ${blockReason}`;
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') return 'Gemini stopped before completing the response.';
  if (finishReason) return `Gemini could not complete the response: ${finishReason}`;
  return 'Gemini returned an empty response.';
}

function parseStructuredResponse(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function hasCompleteTranslationResponse(text) {
  const parsed = parseStructuredResponse(text);
  const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
  const translations = variants
    .map(variant => String(variant?.translation || '').trim().toLocaleLowerCase())
    .filter(Boolean);
  return variants.length === 3
    && new Set(translations).size === 3
    && variants.every(variant => (
      String(variant?.translation || '').trim()
      && String(variant?.backTranslationJa || '').trim()
      && String(variant?.overallNuanceJa || '').trim()
      && String(variant?.register || '').trim()
      && Array.isArray(variant?.vocabularyNotes)
      && variant.vocabularyNotes.some(note => String(note?.expression || '').trim())
    ));
}

function hasCompleteNuanceResponse(text) {
  const parsed = parseStructuredResponse(text);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const terms = entries
    .map(entry => String(entry?.term || '').trim().toLocaleLowerCase())
    .filter(Boolean);
  return entries.length >= 3
    && entries.length <= 5
    && new Set(terms).size >= 3
    && entries.every(entry => (
      String(entry?.term || '').trim()
      && String(entry?.lemma || '').trim()
      && String(entry?.ipa || '').trim()
      && String(entry?.coreMeaningJa || '').trim()
      && String(entry?.nuanceJa || '').trim()
      && Array.isArray(entry?.useCasesJa)
      && entry.useCasesJa.some(value => String(value || '').trim())
      && Array.isArray(entry?.examples)
      && entry.examples.filter(example => (
        String(example?.english || '').trim() && String(example?.japanese || '').trim()
      )).length >= 2
    ));
}

function hasCompleteEnglishQuestionResponse(text) {
  const parsed = parseStructuredResponse(text);
  const examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
  return Boolean(
    String(parsed?.shortAnswerJa || '').trim()
    && String(parsed?.intuitionJa || '').trim()
    && String(parsed?.explanationJa || '').trim()
    && examples.filter(example => (
      String(example?.english || '').trim()
      && String(example?.japanese || '').trim()
    )).length >= 2
  );
}

function hasCompleteKnowledgeResponse(text) {
  const parsed = parseStructuredResponse(text);
  const sections = Array.isArray(parsed?.answer?.sections) ? parsed.answer.sections : [];
  const direct = Array.isArray(parsed?.answer?.directAnswer) ? parsed.answer.directAnswer : [];
  const concepts = Array.isArray(parsed?.concepts) ? parsed.concepts : [];
  const conceptKeys = new Set(concepts.map(concept => String(concept?.key || '').trim()).filter(Boolean));
  const primaryKey = String(parsed?.primaryConcept?.key || '').trim();
  const availableConceptKeys = new Set([...conceptKeys, primaryKey].filter(Boolean));
  const referencedKeys = [
    ...direct,
    ...sections.flatMap(section => (
      Array.isArray(section?.paragraphs)
        ? section.paragraphs.flatMap(paragraph => (Array.isArray(paragraph) ? paragraph : []))
        : []
    )),
  ].map(segment => String(segment?.conceptKey || '').trim()).filter(Boolean);
  const bodyText = [
    ...direct.map(segment => segment?.text || ''),
    ...sections.flatMap(section => (
      Array.isArray(section?.paragraphs)
        ? section.paragraphs.flatMap(paragraph => (
          Array.isArray(paragraph) ? paragraph.map(segment => segment?.text || '') : []
        ))
        : []
    )),
  ].join('');
  return Boolean(
    String(parsed?.title || '').trim()
    && String(parsed?.classification?.majorId || '').trim()
    && String(parsed?.classification?.middleId || '').trim()
    && primaryKey
    && availableConceptKeys.size
    && referencedKeys.every(key => availableConceptKeys.has(key))
    && direct.length
    && sections.length
    // Keep the server-side contract aligned with the client-side persistence
    // validator. Otherwise a response can look complete here, then fail only
    // after it reaches the Knowledge screen.
    && bodyText.length >= 900
    && !/(\*\*|__|```|<\/?[a-z][^>]*>)/i.test(bodyText)
  );
}

function hasCompleteStructuredResponse(actionType, text) {
  const parsed = parseStructuredResponse(text);
  if (!parsed) return false;
  if (actionType === 'translation_variants') return hasCompleteTranslationResponse(text);
  if (actionType === 'nuance_generate') return hasCompleteNuanceResponse(text);
  if (actionType === 'english_question') return hasCompleteEnglishQuestionResponse(text);
  if (actionType === 'knowledge_answer') return hasCompleteKnowledgeResponse(text);
  if (actionType === 'event_parse') {
    const dateTime = value => value === null || /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(value);
    return Boolean(String(parsed.title || '').trim() && dateTime(parsed.start) && dateTime(parsed.end));
  }
  if (actionType === 'planner_action') {
    const actions = new Set(['task', 'event', 'schedule', 'memo', 'database', 'delete_event', 'delete_task', 'delete_memo']);
    const date = value => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
    const time = value => value === null || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!actions.has(parsed.action) || !date(parsed.date) || !date(parsed.dueDate)
      || !time(parsed.startTime) || !time(parsed.endTime) || !time(parsed.dueTime)) return false;
    if (['delete_event', 'delete_task', 'delete_memo'].includes(parsed.action)) {
      return Boolean(String(parsed.targetTitle || parsed.title || '').trim());
    }
    return Boolean(String(parsed.title || '').trim());
  }
  if (actionType === 'task_schedule') {
    const items = Array.isArray(parsed.scheduleItems) ? parsed.scheduleItems : null;
    return Boolean(items && items.every(item => (
      String(item?.taskId || '').trim()
      && /^\d{4}-\d{2}-\d{2}$/.test(item?.date)
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item?.startTime)
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item?.endTime)
      && item.startTime < item.endTime
    )));
  }
  return true;
}

export const maxDuration = 60;

const RETRYABLE_GEMINI_STATUSES = new Set([500, 502, 503, 504]);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestGeminiOnce(key, model, payload, timeoutMs = 50_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1_000), 48_000));
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );
    const data = await upstream.json().catch(() => ({}));
    return { upstream, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestGemini(key, model, payload, timeoutMs = 50_000) {
  const startedAt = Date.now();
  const first = await requestGeminiOnce(key, model, payload, timeoutMs);
  if (first.upstream.ok || !RETRYABLE_GEMINI_STATUSES.has(first.upstream.status)) return first;

  // Gemini 5xx responses are commonly brief service interruptions. Retry once
  // before surfacing the error, without retrying user-caused 4xx responses.
  const remainingMs = timeoutMs - (Date.now() - startedAt) - 1_000;
  if (remainingMs < 8_000) return first;
  await delay(700);
  return requestGeminiOnce(key, model, payload, Math.min(remainingMs, 25_000));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const DEFAULT_SUPABASE_URL = 'https://nhgbvlovptelaqcurobv.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2J2bG92cHRlbGFxY3Vyb2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTY2NzcsImV4cCI6MjA5NjU5MjY3N30.Vgsy9--B3d5FoxoHpvjC00OPPzE2WUwzP8GV2LE4-p4';
const USER_DAILY_LIMIT = 50;
const APP_DAILY_LIMIT = 500;
const APP_MINUTE_LIMIT = 30;
const HANDLER_BUDGET_MS = 55_000;
const NETWORK_SAFETY_MS = 2_000;

function todayJstStr() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function withUsageDate(usage) {
  return usage ? { ...usage, usageDate: usage.usageDate || todayJstStr() } : null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  };
}

async function requireAuthenticatedUser(token, timeoutMs) {
  const cfg = getSupabaseConfig();
  if (!token) throw Object.assign(new Error('AIを使うにはログインしてください。'), { status: 401 });

  const response = await fetchWithTimeout(`${cfg.url}/auth/v1/user`, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
    },
  }, timeoutMs);

  if (!response.ok) {
    throw Object.assign(new Error('ログイン状態を確認できませんでした。もう一度ログインしてください。'), { status: 401 });
  }

  return response.json();
}

async function claimUsage(token, body, timeoutMs) {
  const cfg = getSupabaseConfig();
  const actionType = String(body.actionType || 'ai_request').slice(0, 60);

  const response = await fetchWithTimeout(`${cfg.url}/rest/v1/rpc/claim_ai_usage`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_cost: 1,
      p_action_type: actionType,
      p_user_daily_limit: USER_DAILY_LIMIT,
      p_app_daily_limit: APP_DAILY_LIMIT,
      p_minute_limit: APP_MINUTE_LIMIT,
    }),
  }, timeoutMs);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.message || data?.error || 'AI使用量の確認に失敗しました。SupabaseのAI使用量SQLを反映してください。';
    throw Object.assign(new Error(msg), { status: response.status >= 500 ? 503 : response.status });
  }

  if (data?.ok === false) {
    throw Object.assign(new Error(data.message || '今日のAI利用上限に達しました。明日また使えます。'), {
      status: 429,
      usage: data,
    });
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const startedAt = Date.now();
  const remainingTimeMs = (minimum = 0) => Math.max(0, HANDLER_BUDGET_MS - (Date.now() - startedAt) - minimum);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'Gemini API key is not configured on the server.' });
    return;
  }

  let body;
  try {
    body = validateRequestBody(readBody(req));
  } catch (error) {
    res.status(error?.status || 400).json({ error: error?.message || 'Invalid AI request.' });
    return;
  }
  const token = getBearerToken(req);
  try {
    await requireAuthenticatedUser(token, Math.min(7_000, remainingTimeMs(NETWORK_SAFETY_MS)));
  } catch (error) {
    res.status(error?.status || 500).json({ error: error?.message || 'AI authentication check failed.' });
    return;
  }

  const model = pickModel(body.modelPreference);
  const responseFormat = body.responseFormat;
  const generationConfig = {
    maxOutputTokens: body.maxTokens,
    responseMimeType: responseFormat === 'json' ? 'application/json' : 'text/plain',
    thinkingConfig: pickThinkingConfig(model, body.actionType),
  };
  // Gemini 3.x is tuned for its default sampling values.
  if (!String(model).startsWith('gemini-3')) {
    generationConfig.temperature = responseFormat === 'json' ? 0.2 : 0.4;
  }

  let payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(body.userText || '') }],
      },
    ],
    generationConfig,
  };

  const responseSchema = responseFormat === 'json'
    ? pickResponseSchema(body.actionType, body)
    : null;
  if (responseSchema) payload.generationConfig.responseSchema = responseSchema;

  if (body.systemText) {
    payload.systemInstruction = {
      parts: [{ text: String(body.systemText) }],
    };
  }

  try {
    let { upstream, data } = await requestGemini(
      key, model, payload, Math.min(48_000, remainingTimeMs(NETWORK_SAFETY_MS))
    );
    if (!upstream.ok && upstream.status === 400 && payload.generationConfig.responseSchema) {
      // Some Gemini model revisions reject deeply nested response schemas even
      // though they still support JSON mode. Preserve the prompt contract and
      // retry once without only the optional schema constraint.
      payload = {
        ...payload,
        generationConfig: { ...payload.generationConfig },
      };
      delete payload.generationConfig.responseSchema;
      const schemaFallbackTimeMs = Math.min(48_000, remainingTimeMs(NETWORK_SAFETY_MS));
      if (schemaFallbackTimeMs < 8_000) {
        res.status(504).json({ error: 'AI request timed out before a safe retry could start.' });
        return;
      }
      ({ upstream, data } = await requestGemini(key, model, payload, schemaFallbackTimeMs));
    }
    if (!upstream.ok) {
      const msg = data?.error?.message || `Gemini upstream error ${upstream.status}`;
      res.status(upstream.status).json({ error: msg });
      return;
    }

    let text = extractText(data);
    const incompleteStructured = responseFormat === 'json'
      && !hasCompleteStructuredResponse(body.actionType, text);
    // These actions have action-specific recovery instructions below. They
    // used to be excluded here, making that recovery path unreachable.
    const shouldRetry = !text || incompleteStructured;
    if (shouldRetry) {
      // Preserve room for Vercel to send a useful response and for the client
      // to receive it. A retry is only valuable when it has real time to run.
      const retryTimeoutMs = Math.min(48_000, remainingTimeMs(NETWORK_SAFETY_MS));
      if (retryTimeoutMs < 10_000) {
        res.status(502).json({
          error: 'AIの回答を最後まで整えられませんでした。もう一度お試しください。',
        });
        return;
      }
      const retryPayload = {
        ...payload,
        generationConfig: {
          ...payload.generationConfig,
          maxOutputTokens: Math.min(
            ACTION_LIMITS[body.actionType],
            Math.max(body.maxTokens + 800, 512)
          ),
          thinkingConfig: pickThinkingConfig(model, body.actionType),
        },
      };
      if (body.actionType === 'translation_variants') {
        retryPayload.systemInstruction = {
          parts: [{
            text: `${String(body.systemText || '')}

The previous response was incomplete. Return all three distinct translation variants even when the Japanese is short, fragmentary, colloquial, or ambiguous. Never ask the user to make the Japanese more specific. State reasonable interpretations and assumptions in overallNuanceJa.`,
          }],
        };
      }
      if (body.actionType === 'nuance_generate') {
        retryPayload.systemInstruction = {
          parts: [{
            text: `${String(body.systemText || '')}

The previous response was incomplete. Return three to five distinct expressions with every required explanation field. The user does not need to provide a usage situation: infer several realistic situations for each expression and explain them in useCasesJa. Never ask the user to make the theme or words more specific when a reasonable interpretation is possible.`,
          }],
        };
      }
      if (body.actionType === 'english_question') {
        retryPayload.systemInstruction = {
          parts: [{
            text: `${String(body.systemText || '')}

The previous response was incomplete. Answer the learner's exact question directly even when it is short, colloquial, or ambiguous. Return a concise direct answer, a careful explanation, and at least two natural English examples with Japanese translations. Do not ask the learner to rewrite or clarify the question when a reasonable interpretation is possible.`,
          }],
        };
      }
      if (body.actionType === 'knowledge_answer') {
        retryPayload.systemInstruction = {
          parts: [{
            text: `${String(body.systemText || '')}

The previous response was incomplete or contained formatting noise. Return one complete, self-contained Japanese learning entry. The explanatory body must contain at least 1200 Japanese characters and use natural paragraphs with only content-specific headings. Do not output Markdown, HTML, **, __, or code fences. Put emphasis only in the marks arrays. Never ask the user to clarify when a reasonable interpretation is possible.`,
          }],
        };
      }
      ({ upstream, data } = await requestGemini(key, model, retryPayload, retryTimeoutMs));
      if (!upstream.ok) {
        const msg = data?.error?.message || `Gemini upstream error ${upstream.status}`;
        res.status(upstream.status).json({ error: msg });
        return;
      }
      text = extractText(data);
      if (responseFormat === 'json' && !hasCompleteStructuredResponse(body.actionType, text)) {
        res.status(502).json({
          error: 'AIの回答形式を検証できませんでした。内容は保存されていません。もう一度お試しください。',
        });
        return;
      }
    }

    if (!text) {
      const blockReason = data?.promptFeedback?.blockReason;
      res.status(502).json({ error: blockReason ? `Gemini blocked the request: ${blockReason}` : 'Gemini returned an empty response.' });
      return;
    }

    res.status(200).json({ text, model });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    res.status(timedOut ? 504 : 500).json({
      error: timedOut
        ? 'Geminiの応答がタイムアウトしました。もう一度お試しください。'
        : error?.message || 'Gemini request failed.',
    });
  }
}

export { hasCompleteStructuredResponse, validateRequestBody };
