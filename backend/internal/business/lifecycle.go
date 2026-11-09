package business

import "context"

// ValidateStageTransition is used only by the approved-event execution path.
func (s *Service) ValidateStageTransition(ctx context.Context, p Principal, id, to string) error {
	c, e := s.repo.getCase(ctx, p, id, false)
	if e != nil {
		return e
	}
	if !p.canWrite(c) {
		return Forbidden()
	}
	b, e := s.repo.rules(ctx, p.TenantID, c.ConfigurationVersionID, c.CaseType)
	if e != nil {
		return e
	}
	if c.Stage == to {
		return nil
	}
	for _, next := range b.Transitions[c.Stage] {
		if next == to {
			return nil
		}
	}
	return Conflict("許可されていない段階への移行です。")
}

func (s *Service) AllowedNextStages(ctx context.Context, p Principal, id string) ([]string, error) {
	c, e := s.repo.getCase(ctx, p, id, false)
	if e != nil {
		return nil, e
	}
	b, e := s.repo.rules(ctx, p.TenantID, c.ConfigurationVersionID, c.CaseType)
	if e != nil {
		return nil, e
	}
	return append([]string{}, b.Transitions[c.Stage]...), nil
}
