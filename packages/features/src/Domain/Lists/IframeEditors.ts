import { PermissionName } from '../Permission/PermissionName'
import { NativeFeatureIdentifier } from '../Feature/NativeFeatureIdentifier'
import { NoteType } from '../Component/NoteType'
import { FillIframeEditorDefaults } from './Utilities/FillEditorComponentDefaults'
import { RoleName } from '@standardnotes/domain-core'
import { IframeComponentFeatureDescription } from '../Feature/IframeComponentFeatureDescription'
import { AuthenticatorName, SpreadsheetName } from '../Strings/ProductNames'
import { c } from 'ttag'

/**
 * Rite's own Authenticator and Spreadsheet editors (packages/rite-editors).
 * They use new identifiers so they never misinterpret notes made by other apps' editors.
 */
export function IframeEditors(): IframeComponentFeatureDescription[] {
  const authenticator = FillIframeEditorDefaults({
    name: AuthenticatorName,
    note_type: NoteType.Authentication,
    file_type: 'json',
    interchangeable: false,
    identifier: NativeFeatureIdentifier.TYPES.RiteAuthenticatorEditor,
    permission_name: PermissionName.RiteAuthenticatorEditor,
    index_path: 'index.html',
    description: c('B7.FilesSubscriptionHelp.Subscription.Info')
      .t`Keep your two-factor (2FA) codes encrypted with your notes. Add accounts by scanning a QR code or entering the setup key.`,
    availableInRoles: [RoleName.NAMES.CoreUser],
  })

  const spreadsheet = FillIframeEditorDefaults({
    name: SpreadsheetName,
    identifier: NativeFeatureIdentifier.TYPES.RiteSpreadsheetEditor,
    note_type: NoteType.Spreadsheet,
    file_type: 'json',
    interchangeable: false,
    permission_name: PermissionName.RiteSpreadsheetEditor,
    index_path: 'index.html',
    description: c('B7.FilesSubscriptionHelp.Subscription.Info')
      .t`A spreadsheet with formulas, formatting and multiple sheets, encrypted like every other note.`,
    availableInRoles: [RoleName.NAMES.CoreUser],
  })

  return [authenticator, spreadsheet]
}
