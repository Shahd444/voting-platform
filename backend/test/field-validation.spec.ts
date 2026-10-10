import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CategoryDto, CreateUserDto, EventSettingsDto, ExhibitorFormDto, GeofenceDto } from '../src/admin/admin.dto';
import { CastVoteDto } from '../src/visitor/visitor.dto';

describe('create and edit field validation', () => {
  it.each([
    [CategoryDto, { name: 123 }],
    [CategoryDto, { name: '   ' }],
    [EventSettingsDto, { name: ' ' }],
    [EventSettingsDto, { name: 123 }],
    [ExhibitorFormDto, { name: 'Maker', is_active: 'text' }],
    [ExhibitorFormDto, { name: 'Maker', remove_photo: '1' }],
    [CreateUserDto, { username: 'ab', password: 'longpassword' }],
    [CreateUserDto, { username: 'user', password: 'short' }],
    [CastVoteDto, { categoryId: -1, exhibitorId: 1 }],
    [CastVoteDto, { categoryId: 1, exhibitorId: '2' }],
    [CastVoteDto, { categoryId: 1, exhibitorId: 2147483648 }],
    [GeofenceDto, { lat: 0, lng: 0, radius_m: -10 }],
    [GeofenceDto, { lat: '0', lng: 0, radius_m: 100 }],
    [GeofenceDto, { lat: 0, lng: 0, radius_m: 100, max_accuracy_m: -1 }],
  ])('rejects mismatched types and invalid field limits %#', (Dto, body) => {
    expect(validateSync(plainToInstance(Dto as any, body) as object).length).toBeGreaterThan(0);
  });

  it('allows negative coordinates, zero accuracy and digits in text labels', () => {
    expect(validateSync(plainToInstance(GeofenceDto, { lat: -31.5, lng: -35.5, radius_m: 100, max_accuracy_m: 0 }))).toHaveLength(0);
    expect(validateSync(plainToInstance(ExhibitorFormDto, { name: 'Team 42', booth: 'B4', project: '2026', is_active: 'false' }))).toHaveLength(0);
  });
});
