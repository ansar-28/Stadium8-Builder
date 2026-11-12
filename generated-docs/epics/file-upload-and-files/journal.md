## Story 1: Uploaded files list with download
- The Files page now lists real uploaded files from the server, newest first, with paging and a Download button on each row. A failed download keeps a red notification on screen with the server explanation and a Try again button.

## Story 2: Upload a transaction file
- The upload screen now has a working file chooser. It checks the file is a .csv with exactly the seven-column header (reading just the start of the file, so a 1,000-row file doesn't freeze the screen), then sends the raw file to the backend. The outcome appears in a green or red banner, and any rejection also raises a "was rejected at upload" notification.
- The success message leaves out the transaction count because the upload response doesn't include one.

## Story 3: Upload screen for users without the File Importer role
- On the upload screen, users without the File Importer role now see a banner telling them they need that permission and should ask their administrator, with a link back to Files. The file chooser and Upload file button are hidden from them.

## Epic-end code review
- After a successful upload the chosen file is now cleared, so pressing Upload file again can't send the same file twice. The success message stays on screen.
- On the uploaded files list, a file the server returns without an id now shows a disabled Download button instead of requesting a file that doesn't exist.
- Left as planned: exact seven-column header rule, banner plus notification on rejection, and the assumed file-setting values (on the check-first list).

