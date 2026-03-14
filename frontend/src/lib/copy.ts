export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textArea = document.createElement("textarea")
  textArea.value = value
  textArea.setAttribute("readonly", "true")
  textArea.style.position = "fixed"
  textArea.style.top = "-1000px"
  textArea.style.left = "-1000px"
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    const copied = document.execCommand("copy")
    if (!copied) {
      throw new Error("Copy command was rejected")
    }
  } finally {
    document.body.removeChild(textArea)
  }
}
