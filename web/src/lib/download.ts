/** Saves downloaded bytes to the user's computer under the given file name. */
export function saveBlobAsFile(fileContent: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(fileContent);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = fileName;
  downloadLink.rel = 'noopener';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  // Revoking in the same tick can cancel the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
