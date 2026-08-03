# FAQ & Troubleshooting

## Access and navigation

### Do I need to sign in?

No. The current application pages are accessible without login. Use only the address supplied by your department, and do not paste material that is not authorised for this system.

### Where did the old “new content” screen go?

The current UI separates the journeys:

- **"क्रिएटिव्ह आणि सोशल"** starts from a finished article and creates a visual.
- **"लेख / बातमी"** starts from raw notes, recordings, YouTube, or official documents and creates the article.

### Can I close a generation page?

Yes. Server-side work continues. Reopen it from **"सुरू असलेली कामे"** or **"मागील काम"**. A local file picker that was never submitted may need to be selected again after refresh.

## Input and file messages

| Message                                                                         | Meaning and action                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **"कृपया किमान २० अक्षरांची टिपणी लिहा."**                                      | The creative source is too short. Add enough factual context.          |
| **"कृपया टिपणी लिहा, किमान एक फाईल जोडा किंवा यूट्युब लिंक द्या."**             | The article intake has no usable source. Add at least one.             |
| **"फक्त PDF, DOCX आणि TXT फाईल्स चालतात."**                                     | Choose a supported document type. Audio belongs in the audio picker.   |
| **"फाईल खूप मोठी आहे. प्रत्येक फाईल कमाल ५० MB असावी. कृपया लहान फाईल निवडा."** | Reduce or split the file, then select it again.                        |
| **"ही फाईल आता उपलब्ध नाही. कृपया पुन्हा अपलोड करा."**                          | The temporary document job expired or the API restarted. Upload again. |
| **"किमान एक पृष्ठ निवडा."**                                                     | At least one PDF page must be approved before OCR.                     |
| **"या फाईलमधून एकही पृष्ठ निवडलेले नाही."**                                     | Return to page selection and include the pages you need.               |

### Why does every PDF ask me to select pages?

The current PDF path reads selected pages with OCR so table columns can be preserved. OCR is page-based, so the selection screen prevents excluded pages from being processed or charged. DOCX and TXT do not show this page picker.

### The PDF text has the wrong name or number

OCR guesses from pixels. Correct the page text in the review card before using it. Compare names, dates, amounts, and reference numbers with the PDF image.

### My YouTube link is rejected

Use a full `youtube.com/watch?v=…` or `youtu.be/…` address. **"ही लिंक आधीच जोडली आहे."** means it is already present. **"एकावेळी कमाल १० लिंक जोडता येतील."** means the current intake has reached its limit.

## Article review and generation

### An unrelated minister was suggested

Untick that person in **"व्यक्ती व पदनाम तपासा"**. A glossary suggestion is not automatic approval. Add the correct full name and designation if required.

### “नावे तपासताना अडचण आली” appears

Choose **"नावे पुन्हा तपासा"**, or continue without a designation after manually confirming the article source. The designation lookup is best-effort and should not prevent urgent work.

### Some source files failed

The review page lists each failed source. You may continue without it only if the remaining approved material is sufficient and the omission will not change the article's meaning. Otherwise start again with a readable file.

### The article is ready but the poster is not

They can finish at different times. Review/download the article while the poster continues. The page updates automatically.

## Translation and proofreading

### Why must I review names before translation?

Proper names are easy to mistransliterate. English and Hindi use separate approved spellings. Correct every row and add any missing name before selecting **"भाषांतर सुरू करा"**.

### The Hindi result says “ही नावे तपासा”

The translation was delivered, but those names could not be matched confidently to the approved spelling. Inspect and correct them manually. The warning is not a reason to discard already translated pages.

### A common Hindi word is being kept unchanged

In the name-review row, untick **"हिंदीत जसेच्या तसे ठेवा"**. Use that option for proper names, not generic organisation words or designations.

### Proofreading says the text is over 10,000 characters

Split it into logical sections and check each section. Do not cut a sentence or table row in half.

### Proofreading lists an issue but provides no corrected text

The numeric-preservation guard may have detected that an automatic patch would change a number. Make the correction manually against the official source.

## Poster, caption, and publishing

| Message                                        | What to do                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| **"प्रत्येक खुणेसाठी थोडक्यात सूचना लिहा."**   | Add an instruction to every red marker.                                       |
| **"कृपया थोडक्यात अभिप्राय लिहा."**            | The feedback box needs a clear instruction.                                   |
| **"सध्या X वर पोस्ट करता येणार नाही"**         | Download the poster and copy the caption for the authorised manual X process. |
| **"काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा."** | Wait briefly and retry the affected action once; preserve the current result. |

Red marks point to an element; they do not crop it. Blue boxes reserve background space for an item you will add later. Neither can change the software-stamped logo or footer zone.

Direct Facebook publication is immediate and cannot be withdrawn from the result page. Use the official Facebook account to correct or delete a live post.

## Video

### “दुसरा व्हिडिओ प्रकल्प सध्या तयार होत आहे” appears

Only one active video project can generate at a time. Open the active project and wait for it to finish or fail before starting another.

### When does video become expensive?

Script creation and storyboard stills happen before the main animation spend. The cost confirmation appears when you select **"व्हिडिओ तयार करा"**. Redrawing a still is much cheaper than animating the wrong scene.

### Can I change only one completed scene?

Yes. Return to the storyboard or use the completed scene controls, then select **"फक्त हे दृश्य पुन्हा तयार करा"**. The old complete video remains available during replacement.

### Why is the video longer than the generated scenes?

Every finished video appends the DGIPR contact slate. Narrated output includes silence through the slate so it is not cut off.

## History, storage, and analytics

### Why is a translation or proofread result missing from history?

Ad-hoc translation, proofreading, and temporary document-intake jobs are not stored as permanent generations. Copy or download their results before leaving.

### Are analytics costs exact invoices?

No. They are attributable operational estimates based on recorded services, calls, units, and configured prices. Some rows are explicitly marked estimated. Older work may appear as **"पूर्वीची एकत्रित AI नोंद"** because exact task attribution did not exist at the time.

### A completed task is missing from analytics

Usage logging must never fail the officer's work, so an analytics write can be absent even when the task succeeded. Use provider invoices for financial reconciliation.

## If the problem remains

Record the page, approximate time, visible message, generation or intake link, and the action you selected. Take a screenshot that excludes confidential source text, then send those details to the platform support team. Do not repeatedly submit a paid action while its status is unknown.
