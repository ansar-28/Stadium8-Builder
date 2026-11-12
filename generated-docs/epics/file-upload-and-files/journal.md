## Story 1: Uploaded files list with download
- The Files page now lists real uploaded files from the server, newest first, with paging and a Download button on each row. A failed download keeps a red notification on screen with the server explanation and a Try again button.

## Story 2: Upload a transaction file
- The upload screen now has a working file chooser. It checks the file is a .csv with exactly the seven-column header (reading just the start of the file, so a 1,000-row file doesn't freeze the screen), then sends the raw file to the backend. The outcome appears in a green or red banner, and any rejection also raises a "was rejected at upload" notification.
- The success message leaves out the transaction count because the upload response doesn't include one.

