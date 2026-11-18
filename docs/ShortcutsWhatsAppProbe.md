# First iPhone check: four actions, no batch sends yet

Use this short check before building the complete native runner on iOS 27.2 /
WhatsApp 26.45.75. It discovers what WhatsApp actually exposes on this phone.
No Mac or imported shortcut file is required. The repository's blueprint and
JavaScript test runners are not installed native shortcuts.

In Shortcuts, tap **+**, rename the new shortcut `RSVP WhatsApp Probe`, then open
**Add Action → Apps → WhatsApp**. Inspect each available action's icon →
**Show Info**, especially recipient and image input types. Apple documents this
in [Navigate the action list](https://support.apple.com/guide/shortcuts/navigate-the-action-list-apdc33e4f4da/ios).

The organizer reports these action labels on the target phone:

- **Send message to recipient** for text.
- **Send photo** for the image; the organizer reports that it opens a contact picker.
- Whether **Send photo** accepts a downloaded Image/File variable is still unknown.

These are inspection findings, not successful-send evidence. A contact picker
does not establish that a recipient variable is available. Keep
`ProbeActionsConfigured` and `FirstLiveItemAccepted` false.

The next check is inspection only: add **Send photo**, then tap its image/input
field, if present. If it offers **Select Variable** or a **Magic Variable**, check
whether the earlier synthetic JPEG can be selected. Apple explains
[using variables](https://support.apple.com/guide/shortcuts/use-variables-apdd02c2780c/ios);
this does not establish which fields WhatsApp exposes. If the action instead takes
Share Sheet input, record that requirement. If no input field or variable choice
is visible, record what is shown. **Do not tap Run or send anything.**

Assemble these four actions for inspection, initially **without tapping Run**:

| # | Action | Configuration on this phone |
|---|---|---|
| 1 | **Select Contact** | Choose an approved test contact when run; name output `ProbeRecipient`. |
| 2 | **Get File from Folder** | Pick the supplied synthetic JPEG; name output `ProbeJPEG`. |
| 3 | **Send message to recipient** (reported label) | Inspect whether recipient can bind to `ProbeRecipient`; use clearly labeled synthetic probe text only when the live gate is later accepted. |
| 4 | **Send photo** (reported label) | Inspect whether image can bind to `ProbeJPEG`; its reported contact picker has not established recipient-variable support. |

The last two labels were reported from this phone; their parameter bindings and
completion behavior remain unverified. Do not substitute a guessed intent ID. Do not choose a production
contact. Actual test contacts/numbers stay on the phone and in protected runtime
configuration, outside Git. If the photo action can only show a generic share
sheet or cannot take the same recipient variable, record that limitation and
leave the runner's live branch disabled.

Check and record only these non-secret facts:

- Exact text/photo action names and accepted recipient/image input types.
- Whether both recipient fields can use a variable rather than a fixed contact.
- Whether text is a separate message or forced into a photo caption.
- Any required confirmation, app switching, recipient picker or cancellation UI.

A deliberate probe run sends extra labeled probe messages. For an exactly-six
invitation pilot, **inspect the four actions without running this probe**. Build
its inspected action blocks into [RSVP Batch Runner](ShortcutsNativeRunner.md),
complete the six-item dry run, then use **Run one pending** on the fresh six-item
live-test batch as the supervised functional probe. Continue that **same batch**
with its remaining five only after the first item succeeds. Set the device-only
`ProbeActionsConfigured` flag after inspecting the action fields and recipient
mapping; this permits only the supervised first item. Set `FirstLiveItemAccepted`
only after that item succeeds; this permits the remaining-five branch.
Do not run this probe
in addition or create another live batch to resend the first item.

If an action is absent, its recipient mapping is uncertain, or cancellation does
not produce an unambiguous successful return, stop live processing and retain
that finding. A chat opening or prefilled text does not establish completion:
WhatsApp documents [click-to-chat](https://faq.whatsapp.com/5913398998672934/?locale=fi_FI)
as opening/preparing a chat, and its [Siri guide](https://faq.whatsapp.com/1803878309981730/?cms_platform=iphone&locale=pa_IN)
does not specify a photo Shortcuts action schema. The full runner requires durable
checkpoints and never repeats an uncertain action automatically.

The dry and live tests use the same six synthetic households and existing
invitation codes/links. The live test gets **six fresh reviewed delivery queue
IDs and a new batch** after the dry run. Its first item and remaining five share
one live-test batch. Build details, the upload-only shortcut and recovery steps
are in [ShortcutsNativeRunner.md](ShortcutsNativeRunner.md).
