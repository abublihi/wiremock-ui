import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/ui/components/ui/sheet'

// Dialogs opened through state (no Radix Trigger) must still hand focus back to what opened them.
function StateDialog() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Add user</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StateSheet() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  )
}

function MenuConfirm() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button>Actions</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

describe('dialogs return focus to their opener', () => {
  it('a dialog opened from a button', async () => {
    const ue = userEvent.setup()
    render(<StateDialog />)
    const button = screen.getByRole('button', { name: 'Add user' })
    await ue.click(button)
    await screen.findByRole('dialog')
    await ue.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Radix moves the focus a tick after the content unmounts.
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('a sheet opened from a button', async () => {
    const ue = userEvent.setup()
    render(<StateSheet />)
    const button = screen.getByRole('button', { name: 'Open sheet' })
    await ue.click(button)
    await screen.findByRole('dialog')
    await ue.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Radix moves the focus a tick after the content unmounts.
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('a confirmation opened from a menu item goes back to the menu button', async () => {
    const ue = userEvent.setup()
    render(<MenuConfirm />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await ue.click(trigger)
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await ue.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // Radix moves the focus a tick after the content unmounts.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
