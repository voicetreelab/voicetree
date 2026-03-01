/// <reference types="vite/client" />
import { Suspense, lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import type { RouterProviderProps } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import './index.css'

// Dark mode by default for web share
document.documentElement.classList.add('dark')

const UploadPage: LazyExoticComponent<ComponentType> = lazy(() => import('@/shell/web/UI/pages/UploadPage'))
const ViewerPage: LazyExoticComponent<ComponentType> = lazy(() => import('@/shell/web/UI/pages/ViewerPage'))

const router: RouterProviderProps['router'] = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <UploadPage />
      </Suspense>
    ),
  },
  {
    path: '/upload',
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <UploadPage />
      </Suspense>
    ),
  },
  {
    path: '/share/:id',
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <ViewerPage />
      </Suspense>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
