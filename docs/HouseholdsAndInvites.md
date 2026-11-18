# Households and invitations

## People and household details

Open Households to browse the nested list. Expand a household to see its guests. Household details keeps its primary-contact name/number/service and conditional Food caption visible collapsed or expanded. Expanded reading shows unlabelled address/landline, group path and invited sessions; use the household pencil to edit those details. Save or Cancel returns to the summary.

The top-level and relational-group headers have order arrows, an add icon and a pencil. Guarded Delete is at the lower right of each group editor, opposite Save/Cancel. Household and individual guest editors use the same footer layout for Archive/Restore/Delete; archived records can be opened for Restore while their data fields stay read-only. A top-level add icon creates a relational group in that section. A relational-group add icon opens Add household with both groups selected. There is no separate Add household section above the list. Top-level editing requires Settings edit access; relational groups and households require Households edit access.

Existing shared relational groups retain their links and are marked Shared group. Renaming or reordering one applies wherever it appears. New relational groups belong to the selected top-level group. Delete requires an empty group, including no archived households; a top-level group must also have no scoped relational groups, and at least one top-level group must remain.

Show archived records sits beside Expand all / Collapse all. The household statistics box on Overview also shows configured top-level and distinct relational-group counts.

Parent–child grouping, indentation and saved order are kept when browsing invitations. Use the order arrows where available. Archive unused records when you want to retain their history.

Allow food in Household details controls whether the household may participate in food selection. Its food commitments are managed in the Food area for that household or under the food item itself.

## Venues and sessions

A venue is a place. A session is an activity at a place and time. Several sessions can use the same venue.

Use Venues to create and order places and sessions. Check each session’s venue and local time carefully. Manage households on a session lets you add or remove household invitations in bulk. Households → Household details provides session checkboxes and a collapsed Individual guest exceptions section. Save applies the household details and changed invitations together.

On wide screens, the Venues and Sessions & scheduling boxes appear side by side. Opening an editor or Add venue/session expands that box across the row; reading views return to columns when editing closes. Narrower screens stack the boxes.

## Replies

Open Households → Household details for session invitations; use Invites for RSVP management. Review which sessions each household and individual is invited to. Use the provided correction/reopening actions when a guest needs help changing a submitted reply; keep a clear reason for the change.

## Preview the guest experience

Use the eye icon in the administrator toolbar to preview the landing page. In **Invites**, use **Preview** beside a household to see its invitation before publishing. Preview requires a signed-in administrator with view access to Households, Invites and Venues, plus Food when that feature is enabled. Test replies, food selections and added household guests stay in that preview only and disappear when you reload or close the tab. Preview guest additions never change the real guest list.

While the event is unpublished, you can keep planning and previewing invitations. New invitation codes are issued when you publish. Previously issued codes stay reserved. Published Invites rows hide the preview eye and household pencil. Create or review a delivery and use its share controls; Sent remains a separate manual confirmation.

## Set up invitation templates

Open the **Settings → Templates → Add template** disclosure, enter a name and check Email, SMS, WhatsApp and/or Messenger. Enable the content you want under Options: Subject, Message, Short Message and Picture. Short Message is a single-line field used for SMS when enabled; otherwise SMS uses Message. SMS remains text only. Unchecked options hide their fields and placeholder help while retaining content. Picture controls open immediately below their button. Templates have no language controls: choose a named template with the wording you want. Venue/session context, the private album and placeholder help remain available. Use the pencil to edit, Save/Cancel on the left and red Delete on the right. Deleting a template leaves existing delivery snapshots/history unchanged.

To test on your phone while the event remains unpublished, use **Test sharing** beside a saved template, or open its pencil to test an unsaved picture/text draft. The dialog uses example names and this installation's landing-page preview link (`#guest-preview=landing`), never a household invitation code. The landing preview retains its existing administrator sign-in and permission requirements. Choose yourself in WhatsApp or Messenger and check the picture/text/link. It creates no invitation or delivery record and does not mark anything Sent. Unsaved picture/text edits can be tested before Save.

An optional **Invitation picture** accepts a JPEG under 1.4 MB. The application re-encodes it, removes embedded metadata and limits it to 2400 pixels. It is stored privately with the template and copied into each new delivery draft. You can replace or remove the picture in a draft. Saving a changed template does not change existing drafts or sent history. Cancel discards your picture edit; a failed save retains it for retry.

Use `{invitation_link}` in the message. You can also use `{household_name}` and `{event_name}`. New drafts fill these in automatically. The chosen named template supplies the same content regardless of household language. If no template applies, the draft starts with the invitation link.

## Invites overview

Overview holds the existing statistics cards. Invites opens with active households containing guests grouped by top-level and relational group. Grouped Invites follows Households: configured top-level order, relational-group order, then parents before their descendants with manual sibling ordering. Empty grouping households are omitted from Invites while preserving their descendants’ place. Use **Settings → Interface → Invites appearance** to save or cancel **Group by top-level / relational group**. The saved preference controls grouped/flat Invites and follows your administrator account across devices. Its progress buttons filter **Not sent**, **Ready**, **Marked sent**, **Awaiting reply** and **Replied**. Counts are households, not individual delivery attempts; sent/ready/replied categories can overlap when a reminder is being prepared. The latest draft/attempt and last recorded sent date remain separate from RSVP status. A reopened RSVP is awaiting a new response even if earlier responses remain in history.

Search household or recipient details, or filter by group, language and delivery channel. Save **Group by top-level / relational group** under Invites appearance inside the Interface box for a grouped view. Before publication the controls are **+**, preview eye and household pencil. **+** opens the named template chooser, then creates a draft and opens its inline delivery review. **Shown fields**, at the top right of the Invites box, controls the optional columns. Wide action buttons stay on one row when Food is shown. Food Interest appears only during Collect interest, and Food items during Choose food; unanswered/zero is shown as a dash. When published, a share icon appears for households with delivery records and opens **Invitation delivery** inline, including draft editing, Ready actions and history. Empty delivery sections are hidden. RSVP management remains available inside the expanded row; session invitation choices are in Household details.

Drafts can be prepared while unpublished, using `{invitation_link}` as a placeholder without issuing or releasing a code. Marking ready, opening messaging apps and recording sending remain publication gated. After publication, reopen and save the draft to resolve its current link and recipient/code snapshot before marking it ready. Sent and cancelled records remain read-only; a reminder is a separate draft. Use Delete in a saved draft’s reading footer or editor to remove an unsent draft from active delivery lists. Its retired snapshot and audit history remain retained; Ready, Sent and handed-off records cannot be deleted this way. Notes/reasons and sending acknowledgements use the existing delivery history.

## Make and send bulk invites

**Main → Overview → Manage Invites** prepares existing household invitations in one compact list. **Create all household templates** creates a Draft for each active household with guests and no current delivery record, using its matching saved template. Existing drafts, Ready records and delivery history are retained. Draft preparation is available while unpublished.

Use **Shown Services** to display Messages, Email, WhatsApp, SMS and None. Messages is the default mobile route when no service was chosen. SMS retains an explicit SMS choice. None supports a manual invitation without guessing a recipient address or phone number.

**Shown Invites** filters Sent, Draft and No Draft. Draft includes Ready and Failed records, and the filter uses the current delivery for each household.

Select up to ten households using the right-hand checkboxes. After publication, use **Review selected drafts** and **Mark ready** to approve complete drafts. **Apple Share** and **Copy & Paste** then show each selected household separately with its own recipient and private invitation link. Apple Share needs HTTPS or localhost and native browser sharing support. Copy & Paste also offers manual text selection.

**Send via Apple Shortcuts** opens the existing iPhone Shortcuts batch review for the selected eligible Ready WhatsApp drafts. It requires the experimental feature, a trusted HTTPS website/API and sending permission. Continue the existing review and launch steps there. Native Runner device acceptance remains pending. Sharing or preparing a batch leaves Sent confirmation to the organizer.

## Send an invitation or reminder

1. Prepare a delivery draft and check the recipient, message and private link.
2. Save it as ready when it is correct.
3. Use **Share invitation** to review the recipient/message, then tap **Share invitation** in the dialog to open your system share sheet. Choose an available app and the displayed recipient. Alternatively, use the existing Mail, Messages or WhatsApp handoff.
4. Review it in that app and tap Send.
5. Return to RSVP Manager and record that you sent it.

A successful system share handoff adds a separate **Share handoff completed** entry under invitation activity in the administration log. This is the browser’s report of a handoff, not proof of sending or delivery. Cancelling does not add a handoff entry. If logging fails after sharing, use **Retry logging**; it records the same handoff without sharing again. **Record as sent** remains your manual confirmation.

The native share sheet requires HTTPS and browser/device support. Its destinations depend on installed apps; Apple Messages handles iMessage/SMS according to your device configuration. The website cannot identify the chosen app or recipient. Note the actual app when recording sending; use Manual delivery for apps without a dedicated channel, such as Messenger. Unsupported browsers offer **Copy message**.

For a draft with a picture, the share dialog previews it and offers **Share picture and text**, **Share picture**, and **Copy message**. Some Apple/app combinations accept only one part of a combined share. If the picture or text is missing in WhatsApp or Messenger, share the picture separately, copy the message and paste it into the destination app. Keep the invitation link in the message and check both before sending. Direct Mail/Messages/WhatsApp composer links carry text only; use the native share dialog for a picture. The website cannot confirm which parts the receiving app retained.

Pictures are included in application backups and private saved delivery snapshots. Full backup files still have the existing size limit; pictures and repeated delivery history count toward it. Actual iPhone/iPad WhatsApp and Messenger behavior needs device acceptance. This feature does not publish an event or mark a message Sent.

Opening an app does not send the message or mark it as sent. The delivery log records your manual confirmation; it does not provide provider delivery or read receipts.

A reminder is a new draft. It does not change the original sending record.

Editing invitations and sending them are separate permissions. Someone may be allowed to prepare drafts without sending, or send a prepared invitation without editing it.

In **Invites**, expand a household to see **RSVP** and **Invitation delivery** in place. Session invitations are in **Households → Household details**, using the household’s Save/Cancel controls. Individual guest exceptions retain Follow household / Invited / Not invited, and RSVP history protects invitation changes. Use **Copy link** on the row to copy the private invitation link after publication.

## Guest and household contact details

Use a guest’s pencil to enter their Phone, Mobile and Email. Choose Email, SMS or WhatsApp as their preferred method, or leave it unspecified. SMS and WhatsApp use the guest’s Mobile number.

Under **Household details**, use **Add Contact** to choose an active adult in your household or from the guest list, or add a contact separately. Save the household to apply the choice. New invitation drafts can use the primary guest’s current details. The household itself still has a Landline and Postal address.

Guest lists show adults first, then children, using saved manual order within each section and alphabetical order where no position is saved. Row arrows move people within their adult/child section; changing status or adding a person appends them to the appropriate section. Admin, invitation, review and confirmed lists use the same policy. Household arrows reorder siblings, including child households.

## Delete an unused archived record

**Delete** is available on household and guest rows while the event is unpublished. Once published, archive a record first and turn on **Show archived records** to find **Delete** next to **Restore**. Move or delete a household’s guests and child households first. Records with dependent activity, such as RSVP history or delivery records, must stay archived. Retired codes stay reserved and administration log entries are retained.

[All user guides](README.md)

## Guest RSVP comments

Guests can add one optional household comment while reviewing attendance, for example dietary requirements. Find the latest comment under **Invites → household → RSVP**. Confirmation stores it with the immutable submission; organizer reopening allows a new submission without changing the old comment. It is separate from internal household notes and is included in full application backups.

## Food-interest follow-up

With Food View permission, Invites offers **Food interest → All / Yes / No / Unanswered**, retaining search, other filters and household hierarchy order. Each household’s row shows its stored answer; these states are independent of RSVP and delivery. The Food items summary shows counts for active households with active guests, excluding archived and empty grouping households. Answering Yes alone does not reserve food or grant access to the detailed list.

## Placeholder categories and correction

Settings → Placeholders and the field's {…} help use category tabs and search. Field help offers only tokens supported by that field. Choose Event, Household, Venue or another available category; there is no context dropdown.

If a template identifies a retired `{invite-deadline}` token, choose its explicit replacement with `{rsvp_deadline}`. A signed offset such as `:+4` is retained. This changes only the current draft; Save applies it and Cancel discards it. Stored templates are not rewritten automatically, and unsupported tokens remain rejected.
