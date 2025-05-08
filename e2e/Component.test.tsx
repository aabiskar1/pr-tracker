
import React from 'react'
import { expect, $ } from '@wdio/globals'
import { createRoot } from 'react-dom/client'

import ExampleComponent from './Component'

describe('React Component Tests', () => {
    
    let container: Element

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        container?.remove()
    })
    

    it('should test component with WebdriverIO', async () => {
        const root = createRoot(container)
        root.render(<ExampleComponent />)

        const component = await $('button*=count is')
        await expect(component).toBePresent()
        await expect(component).toHaveText('count is 0')

        await component.click()
        await component.click()

        await expect(component).toHaveText('count is 2')
        // Visual snapshots require additional setup, removed for now
        // await expect(component).toMatchElementSnapshot('counterButton')
    })
})
