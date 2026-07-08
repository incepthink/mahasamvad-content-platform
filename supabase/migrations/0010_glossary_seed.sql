-- Verified glossary seed. Bootstraps the Marathi->English name lock-dictionary with
-- evergreen, publicly-verifiable mappings so translations get proper nouns right from
-- day one (before any human has reviewed the auto-mined candidates from a translation).
--
-- RULES (see AGENTS.md "never invent names"):
--   * Only stable, publicly-verifiable terms are seeded here: government designations,
--     Maharashtra district/city names, and standing institutions. These do not change
--     with who is in office, so seeding them can never be "wrong".
--   * Current office-holders (ministers, collectors, etc.) are DELIBERATELY NOT seeded
--     — those are volatile and would go stale/wrong. They flow in as auto-mined
--     candidates (verified=false) and a human confirms them in the /glossary review UI.
--   * Every seed row is verified=true, source='seed'. Only verified rows lock into a
--     translation, so this seed is authoritative immediately.
--
-- Idempotent: re-running does nothing to existing rows (on conflict (marathi) do nothing),
-- so a human correction to a seeded term's english/type is never clobbered by a re-apply.

-- ---------- Designations (पदनाम) ----------
insert into glossary_terms (marathi, english, term_type, verified, source) values
  ('मुख्यमंत्री',                 'Chief Minister',            'designation', true, 'seed'),
  ('उपमुख्यमंत्री',               'Deputy Chief Minister',     'designation', true, 'seed'),
  ('मंत्री',                      'Minister',                  'designation', true, 'seed'),
  ('राज्यमंत्री',                 'Minister of State',         'designation', true, 'seed'),
  ('आमदार',                       'MLA',                       'designation', true, 'seed'),
  ('खासदार',                      'MP',                        'designation', true, 'seed'),
  ('जिल्हाधिकारी',               'District Collector',        'designation', true, 'seed'),
  ('उपजिल्हाधिकारी',             'Deputy Collector',          'designation', true, 'seed'),
  ('मुख्य कार्यकारी अधिकारी',    'Chief Executive Officer',   'designation', true, 'seed'),
  ('गटविकास अधिकारी',           'Block Development Officer', 'designation', true, 'seed'),
  ('तहसीलदार',                    'Tehsildar',                 'designation', true, 'seed'),
  ('सरपंच',                       'Sarpanch',                  'designation', true, 'seed'),
  ('आयुक्त',                      'Commissioner',              'designation', true, 'seed'),
  ('पोलीस आयुक्त',               'Police Commissioner',       'designation', true, 'seed'),
  ('पोलीस अधीक्षक',              'Superintendent of Police',  'designation', true, 'seed'),
  ('सचिव',                        'Secretary',                 'designation', true, 'seed'),
  ('प्रधान सचिव',                'Principal Secretary',       'designation', true, 'seed'),
  ('अपर मुख्य सचिव',            'Additional Chief Secretary','designation', true, 'seed')
on conflict (marathi) do nothing;

-- ---------- Places (ठिकाण): the 36 Maharashtra districts + state + major cities ----------
-- District names are public and stable. Recently-renamed districts are seeded under both
-- their current and former names (distinct keys) so either spelling in a note resolves.
insert into glossary_terms (marathi, english, term_type, verified, source) values
  ('महाराष्ट्र',              'Maharashtra',          'place', true, 'seed'),
  ('मुंबई',                   'Mumbai',               'place', true, 'seed'),
  ('मुंबई शहर',              'Mumbai City',          'place', true, 'seed'),
  ('मुंबई उपनगर',           'Mumbai Suburban',      'place', true, 'seed'),
  ('नवी मुंबई',             'Navi Mumbai',          'place', true, 'seed'),
  ('पिंपरी चिंचवड',        'Pimpri-Chinchwad',     'place', true, 'seed'),
  ('ठाणे',                    'Thane',                'place', true, 'seed'),
  ('पालघर',                   'Palghar',              'place', true, 'seed'),
  ('रायगड',                   'Raigad',               'place', true, 'seed'),
  ('रत्नागिरी',              'Ratnagiri',            'place', true, 'seed'),
  ('सिंधुदुर्ग',             'Sindhudurg',           'place', true, 'seed'),
  ('पुणे',                    'Pune',                 'place', true, 'seed'),
  ('सातारा',                  'Satara',               'place', true, 'seed'),
  ('सांगली',                  'Sangli',               'place', true, 'seed'),
  ('कोल्हापूर',              'Kolhapur',             'place', true, 'seed'),
  ('सोलापूर',                'Solapur',              'place', true, 'seed'),
  ('नाशिक',                   'Nashik',               'place', true, 'seed'),
  ('अहमदनगर',                'Ahmednagar',           'place', true, 'seed'),
  ('अहिल्यानगर',            'Ahilyanagar',          'place', true, 'seed'),
  ('धुळे',                    'Dhule',                'place', true, 'seed'),
  ('नंदुरबार',               'Nandurbar',            'place', true, 'seed'),
  ('जळगाव',                   'Jalgaon',              'place', true, 'seed'),
  ('छत्रपती संभाजीनगर',    'Chhatrapati Sambhajinagar', 'place', true, 'seed'),
  ('औरंगाबाद',               'Aurangabad',           'place', true, 'seed'),
  ('जालना',                   'Jalna',                'place', true, 'seed'),
  ('बीड',                     'Beed',                 'place', true, 'seed'),
  ('धाराशिव',                'Dharashiv',            'place', true, 'seed'),
  ('उस्मानाबाद',            'Osmanabad',            'place', true, 'seed'),
  ('लातूर',                   'Latur',                'place', true, 'seed'),
  ('नांदेड',                  'Nanded',               'place', true, 'seed'),
  ('परभणी',                   'Parbhani',             'place', true, 'seed'),
  ('हिंगोली',                'Hingoli',              'place', true, 'seed'),
  ('नागपूर',                  'Nagpur',               'place', true, 'seed'),
  ('वर्धा',                   'Wardha',               'place', true, 'seed'),
  ('भंडारा',                  'Bhandara',             'place', true, 'seed'),
  ('गोंदिया',                'Gondia',               'place', true, 'seed'),
  ('चंद्रपूर',               'Chandrapur',           'place', true, 'seed'),
  ('गडचिरोली',               'Gadchiroli',           'place', true, 'seed'),
  ('अमरावती',                'Amravati',             'place', true, 'seed'),
  ('अकोला',                   'Akola',                'place', true, 'seed'),
  ('वाशिम',                   'Washim',               'place', true, 'seed'),
  ('बुलढाणा',                'Buldhana',             'place', true, 'seed'),
  ('यवतमाळ',                  'Yavatmal',             'place', true, 'seed')
on conflict (marathi) do nothing;

-- ---------- Organisations / institutions (संस्था) ----------
insert into glossary_terms (marathi, english, term_type, verified, source) values
  ('शासन',                    'Government',                  'org', true, 'seed'),
  ('सरकार',                   'Government',                  'org', true, 'seed'),
  ('महाराष्ट्र शासन',       'Government of Maharashtra',    'org', true, 'seed'),
  ('महाराष्ट्र सरकार',      'Government of Maharashtra',    'org', true, 'seed'),
  ('केंद्र सरकार',          'Central Government',           'org', true, 'seed'),
  ('राज्य सरकार',           'State Government',             'org', true, 'seed'),
  ('मंत्रिमंडळ',             'Cabinet',                     'org', true, 'seed'),
  ('विधानसभा',                'Legislative Assembly',        'org', true, 'seed'),
  ('विधानपरिषद',             'Legislative Council',         'org', true, 'seed'),
  ('जिल्हा परिषद',          'Zilla Parishad',              'org', true, 'seed'),
  ('पंचायत समिती',          'Panchayat Samiti',            'org', true, 'seed'),
  ('ग्रामपंचायत',           'Gram Panchayat',              'org', true, 'seed'),
  ('महानगरपालिका',          'Municipal Corporation',       'org', true, 'seed'),
  ('नगरपालिका',              'Municipal Council',           'org', true, 'seed')
on conflict (marathi) do nothing;

-- ---------- Persons (व्यक्ती) ----------
-- DELIBERATELY EMPTY. Do NOT seed current office-holders' names here — they are volatile
-- and seeding a stale/wrong name would violate the "never invent names" rule. Current
-- minister/official names arrive as auto-mined candidates (verified=false) on each
-- translation and are confirmed by a human in the /glossary review UI. When the team is
-- ready to pin evergreen persons, add them below as
--   ('<मराठी नाव>', '<Official English spelling>', 'person', true, 'seed')
-- using each person's own publicly-published English spelling — never a transliteration guess.
