import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { analyzeAccessibility } from "@/tests/accessibility/axe";

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  Chip,
  Dialog,
  LiveRegion,
  NavigationHeader,
  Notice,
  PageHeader,
  Progress,
  RadioField,
  SegmentedControl,
  Skeleton,
  StatePanel,
  Switch,
  TextAreaField,
  TextField,
} from ".";

describe("common UI components", () => {
  it("places the page header description below the title", () => {
    render(<PageHeader title="받은 알림" description="아직 확인하지 않은 알림 2건" />);

    const title = screen.getByRole("heading", { level: 1, name: "받은 알림" });
    const description = screen.getByText("아직 확인하지 않은 알림 2건");
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders headers, cards, status indicators, and feedback with accessible names", async () => {
    const { container } = render(
      <main>
        <PageHeader title="받은 알림" eyebrow="응답 현황" action={<Button>새 알림</Button>} />
        <NavigationHeader
          title="운영팀"
          href="/groups"
          navigationLabel="그룹 목록으로"
          step="1 / 2"
        />
        <Card>
          <CardHeader title="3명 중 2명이 확인했어요" meta="2회차" />
          <Progress value={2} max={3} label="수신자 3명 중 2명 확인" />
          <Badge status="confirmed">확인</Badge>
          <Badge status="unconfirmed">미확인</Badge>
          <Avatar initial="지수" name="지수" />
        </Card>
        <Notice>가입 전에 발송된 회차는 볼 수 없어요.</Notice>
        <LiveRegion>복사했어요.</LiveRegion>
        <Skeleton label="알림을 불러오는 중" lines={2} />
        <StatePanel
          kind="empty"
          title="받은 알림이 없어요"
          description="새 알림을 작성해 보세요."
          action={<Button>새 알림 작성</Button>}
        />
      </main>,
    );

    expect(screen.getByRole("heading", { name: "받은 알림", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "그룹 목록으로" })).toHaveAttribute("href", "/groups");
    expect(screen.getByRole("progressbar", { name: "수신자 3명 중 2명 확인" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByRole("img", { name: "지수 아바타" })).toHaveTextContent("지");
    expect(screen.getByRole("status")).toHaveTextContent("복사했어요.");
    expect(screen.getByText("알림을 불러오는 중").parentElement).toHaveAttribute("aria-busy", "true");

    const results = await analyzeAccessibility(container);
    expect(results.violations).toEqual([]);
  });

  it("connects visible labels, descriptions, and errors to form fields", async () => {
    const { container } = render(
      <form>
        <TextField
          id="nickname"
          label="닉네임"
          description="다른 사용자에게 표시돼요."
          error="1자 이상 20자 이하로 입력해 주세요."
        />
        <TextAreaField
          id="sentence"
          label="어떤 알림을 보낼까요?"
          description="제목 없이 한 문장으로 보내요."
        />
      </form>,
    );

    const nickname = screen.getByRole("textbox", { name: "닉네임" });
    expect(nickname).toHaveAccessibleDescription(
      "다른 사용자에게 표시돼요. 1자 이상 20자 이하로 입력해 주세요.",
    );
    expect(nickname).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("1자 이상 20자 이하로 입력해 주세요.");
    expect(screen.getByRole("textbox", { name: "어떤 알림을 보낼까요?" })).toHaveAccessibleDescription(
      "제목 없이 한 문장으로 보내요.",
    );

    const results = await analyzeAccessibility(container);
    expect(results.violations).toEqual([]);
  });

  it("exposes selection state and updates interactive controls", async () => {
    const user = userEvent.setup();

    function Controls() {
      const [mode, setMode] = useState("personal");
      const [enabled, setEnabled] = useState(false);
      const [selected, setSelected] = useState(false);

      return (
        <div>
          <SegmentedControl
            legend="발송 방식"
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "personal", label: "개인" },
              { value: "group", label: "그룹" },
            ]}
          />
          <Chip selected={selected} onClick={() => setSelected((current) => !current)}>
            매주
          </Chip>
          <CheckboxField id="friend" label="지수" />
          <RadioField id="team" name="team" label="운영팀" description="구성원 4명" />
          <Switch
            checked={enabled}
            label="내 이메일 공개"
            description="끄면 닉네임만 보여요."
            onCheckedChange={setEnabled}
          />
        </div>
      );
    }

    render(<Controls />);

    await user.click(screen.getByRole("radio", { name: "그룹" }));
    expect(screen.getByRole("radio", { name: "그룹" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "매주" }));
    expect(screen.getByRole("button", { name: "매주" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("switch", { name: "내 이메일 공개" }));
    expect(screen.getByRole("switch", { name: "내 이메일 공개" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch")).toHaveAccessibleDescription("끄면 닉네임만 보여요.");
    expect(screen.getByRole("checkbox", { name: "지수" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "운영팀" })).toHaveAccessibleDescription("구성원 4명");
  });

  it("traps dialog focus, closes with Escape, and restores the trigger focus", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    function DialogExample() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>그룹 탈퇴</Button>
          <Dialog
            open={open}
            title="운영팀에서 탈퇴할까요?"
            description="탈퇴하면 그룹 알림과 응답 현황을 볼 수 없어요."
            cancelLabel="계속 참여"
            confirmLabel="탈퇴"
            destructive
            onClose={() => setOpen(false)}
            onConfirm={onConfirm}
          />
        </>
      );
    }

    render(<DialogExample />);
    const trigger = screen.getByRole("button", { name: "그룹 탈퇴" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "운영팀에서 탈퇴할까요?" });
    const cancel = within(dialog).getByRole("button", { name: "계속 참여" });
    const confirm = within(dialog).getByRole("button", { name: "탈퇴" });
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders error and permission states without exposing protected content", () => {
    render(
      <>
        <StatePanel
          kind="error"
          title="정보를 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요."
        />
        <StatePanel
          kind="unavailable"
          title="조회 불가"
          description="가입 전에 발송된 회차예요."
        />
        <StatePanel
          kind="forbidden"
          title="조회 권한 없음"
          description="현재 그룹 구성원만 볼 수 있어요."
        />
      </>,
    );

    expect(screen.getByRole("alert")).toHaveAccessibleName("정보를 불러오지 못했어요");
    expect(screen.getByRole("status")).toHaveAccessibleName("조회 권한 없음");
    expect(screen.getByText("조회 불가")).toBeInTheDocument();
    expect(screen.queryByText("비공개 알림 문장")).not.toBeInTheDocument();
  });

  it("moves an available dispatch selector with arrow keys while keeping unavailable rounds disabled", async () => {
    const user = userEvent.setup();

    function DispatchSelector() {
      const [selectedRound, setSelectedRound] = useState("2");

      return (
        <SegmentedControl
          legend="발송 회차 선택"
          name="dispatch-round"
          value={selectedRound}
          onChange={setSelectedRound}
          options={[
            { value: "1", label: "1회차 조회 불가", disabled: true },
            { value: "2", label: "2회차" },
            { value: "3", label: "3회차" },
          ]}
        />
      );
    }

    render(<DispatchSelector />);

    const unavailableRound = screen.getByRole("radio", { name: "1회차 조회 불가" });
    const secondRound = screen.getByRole("radio", { name: "2회차" });
    const thirdRound = screen.getByRole("radio", { name: "3회차" });

    expect(unavailableRound).toBeDisabled();
    expect(secondRound).toBeChecked();

    secondRound.focus();
    await user.keyboard("{ArrowRight}");
    expect(thirdRound).toBeChecked();
    expect(thirdRound).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(secondRound).toBeChecked();
    expect(secondRound).toHaveFocus();
  });

  it("preserves readable, accessible controls in a 200% zoom container", async () => {
    const longGroupName = "아주 긴 그룹 이름도 이백 퍼센트 확대에서 줄바꿈되어 완전하게 읽을 수 있어야 해요";
    const { container } = render(
      <div style={{ width: "320px", zoom: "2" }}>
        <TextField
          id="zoomed-group-name"
          label={longGroupName}
          description="확대된 화면에서도 입력 필드의 설명을 확인할 수 있어요."
        />
        <SegmentedControl
          legend="확대된 발송 회차 선택"
          name="zoomed-round"
          value="current"
          onChange={() => undefined}
          options={[
            { value: "previous", label: "지난 회차 조회 불가", disabled: true },
            { value: "current", label: "현재 회차" },
          ]}
        />
        <Button>{longGroupName}</Button>
      </div>,
    );

    expect(screen.getByRole("textbox", { name: longGroupName })).toHaveAccessibleDescription(
      "확대된 화면에서도 입력 필드의 설명을 확인할 수 있어요.",
    );
    expect(screen.getByRole("radio", { name: "지난 회차 조회 불가" })).toBeDisabled();
    expect(screen.getByRole("button", { name: longGroupName })).toBeVisible();

    const results = await analyzeAccessibility(container);
    expect(results.violations).toEqual([]);
  });
});
