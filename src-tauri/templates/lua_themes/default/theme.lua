-- Default Theme
-- Blue → Cyan → White gradient

gradient = {
    bottom = {20, 80, 180},       -- Dark blue
    middle = {30, 136, 229},      -- Blue
    top = {100, 210, 255}         -- Light cyan
}

function lerp(a, b, t)
    return a + (b - a) * t
end

function lerp_color(c1, c2, t)
    return {
        lerp(c1[1], c2[1], t),
        lerp(c1[2], c2[2], t),
        lerp(c1[3], c2[3], t)
    }
end

function gradient_color(t)
    t = math.max(0, math.min(1, t))
    if t < 0.5 then
        return lerp_color(gradient.bottom, gradient.middle, t * 2)
    else
        return lerp_color(gradient.middle, gradient.top, (t - 0.5) * 2)
    end
end

function render(ctx, state, data)
    local w, h = ctx:size()
    local center_y = h / 2
    local max_h = h * 0.8

    if state == "idle" then
        ctx:set_color(gradient.middle)
        ctx:draw_line(10, center_y, w - 10, center_y, 2)

    elseif state == "recording" then
        -- Waveform bars with gradient
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        for i = 1, bar_count do
            local level = data.levels[i] or 0
            local amp = math.min(1, math.sqrt(level * 8))
            local bar_h = math.max(2, amp * max_h)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                ctx:set_color(gradient_color(t))
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end

    elseif state == "transcribing" then
        -- Traveling wave: 32 bars with gradient
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        for i = 1, bar_count do
            local wave = math.sin(data.phase * 1.5 - (i - 1) * 0.2) * 0.5 + 0.5
            local bar_h = math.max(2, wave * max_h * 0.8)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                ctx:set_color(gradient_color(t))
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end
    end
end
