# iPhone Shortcuts in Invites

Apple Shortcuts is **disabled by default**. An administrator with Settings edit permission can open **Settings → Interface**, use the pencil on **Apple Shortcuts**, select **Enable Apple Shortcuts** and choose **Save**. Event publication, sending permissions and HTTPS are configured separately. **Cancel** keeps the current setting.

When enabled, open **Home → Main** and expand **iPhone Shortcuts** between the statistics boxes and invitation list. The optional panel
uses the existing reviewed WhatsApp delivery drafts, messages, invitation links
and JPEG snapshots. Email, SMS, ordinary WhatsApp and Manual delivery still use
their existing controls.

## Prepare a batch

1. Review the household's delivery and mark it Ready using the normal workflow.
2. On a trusted HTTPS installation with a configured HTTPS callback API, publish
   the event when ready for guests. This panel never publishes it for you.
3. Select at most ten eligible Ready WhatsApp drafts. Open each message/JPEG
   review, verify the recipients and confirm the review checkbox.
4. Choose **Send with iPhone Shortcuts**. This prepares a batch; it does not send
   a message, mark a handoff or mark Sent.
5. Copy launch input, then open a compatible installed runner. Runtime batch
   authorization stays in memory until copied explicitly. Replace the clipboard
   with harmless text after the run. No authorization is placed in the launch URL.

The native [authoring and recovery guide](ShortcutsNativeRunner.md) currently
covers the six-item synthetic pilot. A compatible general runner and the actual
WhatsApp text/photo behavior require acceptance on the iPhone before live guest
use. The website cannot establish that a Shortcut installed, launched or sent a
WhatsApp message. The web installer needs reviewed generic iCloud share links;
it does not create native artifacts.

## Progress and recovery

Batch history shows preparation/expiry and individual pending, in-progress,
processed, partial, failed, unknown and skipped outcomes. Household details show
recipient/channel, handoff, processing, text/photo results, verified delivery
when reliable evidence exists, organizer-confirmed Sent, visits and RSVP.
Processed means the device reported its configured actions completed. It is not
a WhatsApp delivery receipt. Organizer-confirmed Sent remains a separate action
in the existing delivery record.

**Resume this batch** renews its authorization and preserves the same attempts
and pending-result outbox. Use the results-only uploader to retry a callback;
never repeat a send merely because a callback failed. Claimed or processed
attempts are not automatically selected for another batch.

Interrupted, failed, partial and skipped attempts have a separate explicit-retry
review. Stop the old device run, inspect uncertain outcomes and acknowledge that
before creating a new processing attempt. Known completed text/photo steps are
retained by the backend. An uncertain preparation response requires Refresh
progress before another preparation; it is never retried automatically.

Revoke closes batch authorization without erasing history or changing Sent or
RSVP. Revocation remains available to an authorized organizer while unpublished
or using HTTP. Other changes require current sending permission; history requires
Invites read access.

## Invitation visits

Expand any household to see first visit, most recent visit and count, even if it
has no Shortcuts batch. Visits do not submit or confirm RSVP. Administrator
previews are excluded; qualifying visible browser visits are deduplicated using
the existing server rules. Stored timestamps remain UTC and display using the
administrator's time settings. Earlier raw link loads are not converted into
qualified visits.

## Local HTTP installations

The organizer panel can display history and visits over the existing local
setup. Batch preparation, renewed device authorization and launch require a
trusted HTTPS website and callback API. Installing this interface does not change
origins, certificates, runtime credentials or event publication. Synthetic mode
stays isolated from real households in the separate test installation.

## Disable the experiment

Clear the checkbox in Interface and Save. The batch workspace disappears and the server refuses new preparation, renewal, processing claims and image retrieval. Existing authenticated result callbacks can still recover a previously completed action; they cannot mark Sent. A valid device manifest becomes status-only with no invitations. Batch history remains stored and invitation visits still appear in household details. Restoring or wiping application data disables the feature and revokes existing batch capabilities.
