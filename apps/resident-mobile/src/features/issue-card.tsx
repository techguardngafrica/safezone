import { colors } from '@safezone/design-tokens';
import { formatDateTime } from '@safezone/i18n';
import { Card, StatusPill } from '@safezone/mobile-ui';
import { Text, View } from 'react-native';
import { ISSUE_TONE, type Issue, issueStatusLabel } from './issues';

export function IssueCard({ issue, onPress }: { issue: Issue; onPress: () => void }) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${issue.title}, ${issueStatusLabel(issue.status)}`}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.semantic.text, flex: 1 }}>
          {issue.title}
        </Text>
        <StatusPill tone={ISSUE_TONE[issue.status]} label={issueStatusLabel(issue.status)} />
      </View>
      <Text style={{ color: colors.semantic.textMuted, fontSize: 14 }}>
        {issue.number} · {issue.categoryName} · {formatDateTime(issue.createdAt)}
      </Text>
    </Card>
  );
}
