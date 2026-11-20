import { createFileRoute } from '@tanstack/react-router'
import { GuidePage } from '@/ui/components/guide/GuidePage'

export const Route = createFileRoute('/_app/guide')({ component: () => <GuidePage /> })
