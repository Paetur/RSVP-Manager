# Households and invitations

## People and household details

Open Households to browse the nested list. Expand a household to see its guests. Use the pencil to change details, add people or manage contacts.

The top-level and relational-group headers have order arrows, an add icon and a pencil. Guarded Delete is at the lower right of each group editor, opposite Save/Cancel. Household and individual guest editors use the same footer layout for Archive/Restore/Delete; archived records can be opened for Restore while their data fields stay read-only. A top-level add icon creates a relational group in that section. A relational-group add icon opens Add household with both groups selected. There is no separate Add household section above the list. Top-level editing requires Settings edit access; relational groups and households require Households edit access.

Existing shared relational groups retain their links and are marked Shared group. Renaming or reordering one applies wherever it appears. New relational groups belong to the selected top-level group. Delete requires an empty group, including no archived households; a top-level group must also have no scoped relational groups, and at least one top-level group must remain.

Show archived records sits beside Expand all / Collapse all. The household statistics box above Invites also shows configured top-level and distinct relational-group counts.

Parent–child grouping, indentation and saved order are kept when browsing invitations. Use the order arrows where available. Archive unused records when you want to retain their history.

Allow food in Household details controls whether the household may participate in food selection. Its food commitments are managed in the Food area for that household or under the food item itself.

## Venues and sessions

A venue is a place. A session is an activity at a place and time. Several sessions can use the same venue.

Use Venues to create and order places and sessions. Check each session’s venue and local time carefully. Manage households on a session lets you add or remove household invitations in bulk. Invites also provides household defaults and individual guest exceptions.

## Replies

Open Invites for session invitations and RSVP management. Review which sessions each household and individual is invited to. Use the provided correction/reopening actions when a guest needs help changing a submitted reply; keep a clear reason for the change.

## Preview the guest experience

Use the eye icon in the administrator toolbar to preview the landing page. In **Invites**, use **Preview** beside a household to see its invitation before publishing. Preview requires a signed-in administrator with view access to Households, Invites and Venues, plus Food when that feature is enabled. Test replies, food selections and added household guests stay in that preview only and disappear when you reload or close the tab. Preview guest additions never change the real guest list.

While the event is unpublished, you can keep planning and previewing invitations. New invitation codes are issued when you publish. Previously issued codes stay reserved. Once published, use **Copy link** to share a household’s private invitation.

## Set up invitation templates

Open **Settings → Templates** and use the pencil for the channel you want to edit. Expand a language, enter the message for Email, SMS or WhatsApp, and save that channel before editing the next one. Email can also have a subject.

Use `{invitation_link}` in the message. You can also use `{household_name}` and `{event_name}`. New drafts fill these in automatically. If the household’s language has no template for the chosen channel, the draft uses the event’s fallback language, then English. If no template applies, the draft starts with the invitation link.

## Invites overview

Invites opens with event statistics, followed by active households containing guests grouped by top-level and relational group. Grouped Invites follows Households: configured top-level order, relational-group order, then parents before their descendants with manual sibling ordering. Empty grouping households are omitted from Invites while preserving their descendants’ place. Untick **Group by top-level / relational group** to use a flat list; filtering and refreshing data keep your current layout choice during the page session. Its progress buttons filter **Not sent**, **Ready**, **Marked sent**, **Awaiting reply** and **Replied**. Counts are households, not individual delivery attempts; sent/ready/replied categories can overlap when a reminder is being prepared. The latest draft/attempt and last recorded sent date remain separate from RSVP status. A reopened RSVP is awaiting a new response even if earlier responses remain in history.

Search household or recipient details, or filter by group, language and delivery channel. Enable **Group by top-level / relational group** for a grouped view. Preview opens the authorized guest view; Prepare/Review/Follow up expands the delivery tools. Session invitations and RSVP management remain available inside the expanded row.

Drafts can be prepared while unpublished, using `{invitation_link}` as a placeholder without issuing or releasing a code. Marking ready, opening messaging apps and recording sending remain publication gated. After publication, reopen and save the draft to resolve its current link and recipient/code snapshot before marking it ready. Sent and cancelled records remain read-only; a reminder is a separate draft. Notes/reasons and sending acknowledgements use the existing delivery history.

## Send an invitation or reminder

1. Prepare a delivery draft and check the recipient, message and private link.
2. Save it as ready when it is correct.
3. Use **Share invitation** to review the recipient/message, then tap **Share invitation** in the dialog to open your system share sheet. Choose an available app and the displayed recipient. Alternatively, use the existing Mail, Messages or WhatsApp handoff.
4. Review it in that app and tap Send.
5. Return to RSVP Manager and record that you sent it.

A successful system share handoff adds a separate **Share handoff completed** entry under invitation activity in the administration log. This is the browser’s report of a handoff, not proof of sending or delivery. Cancelling does not add a handoff entry. If logging fails after sharing, use **Retry logging**; it records the same handoff without sharing again. **Record as sent** remains your manual confirmation.

The native share sheet requires HTTPS and browser/device support. Its destinations depend on installed apps; Apple Messages handles iMessage/SMS according to your device configuration. The website cannot identify the chosen app or recipient. Note the actual app when recording sending; use Manual delivery for apps without a dedicated channel, such as Messenger. Unsupported browsers offer **Copy message**.

Opening an app does not send the message or mark it as sent. The delivery log records your manual confirmation; it does not provide provider delivery or read receipts.

A reminder is a new draft. It does not change the original sending record.

Editing invitations and sending them are separate permissions. Someone may be allowed to prepare drafts without sending, or send a prepared invitation without editing it.

In **Invites**, expand a household to see **Session invitations**, **RSVP**, and **Invitation delivery** in place. Use **Copy link** on the row to copy the private invitation link after publication.

## Guest and household contact details

Use a guest’s pencil to enter their Phone, Mobile and Email. Choose Email, SMS or WhatsApp as their preferred method, or leave it unspecified. SMS and WhatsApp use the guest’s Mobile number.

Under **Household details**, use **Add Contact** to choose an active adult in your household or from the guest list, or add a contact separately. Save the household to apply the choice. New invitation drafts can use the primary guest’s current details. The household itself still has a Landline and Postal address.

Guest lists show adults first, then children, using saved manual order within each section and alphabetical order where no position is saved. Row arrows move people within their adult/child section; changing status or adding a person appends them to the appropriate section. Admin, invitation, review and confirmed lists use the same policy. Household arrows reorder siblings, including child households.

## Delete an unused archived record

**Delete** is available on household and guest rows while the event is unpublished. Once published, archive a record first and turn on **Show archived records** to find **Delete** next to **Restore**. Move or delete a household’s guests and child households first. Records with dependent activity, such as RSVP history or delivery records, must stay archived. Retired codes stay reserved and administration log entries are retained.

[All user guides](README.md)

## Guest RSVP comments

Guests can add one optional household comment while reviewing attendance, for example dietary requirements. Find the latest comment under **Invites → household → RSVP**. Confirmation stores it with the immutable submission; organizer reopening allows a new submission without changing the old comment. It is separate from internal household notes and is included in full application backups.
