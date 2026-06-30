// layouts/PublicLayout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import { Container } from '@mui/material';

const PublicLayout = () => {
  return (
    <Container maxWidth="md" sx={{ pt: 4 }}>
      <Outlet />
    </Container>
  );
};

export default PublicLayout;
